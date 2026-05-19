import { Effect, Random, Stream } from "effect"
import * as Chunk from "effect/Chunk"

import type {
  BenchMeasurement,
  BenchOptions,
  BenchRecommendation,
  BenchResult,
  BenchStatus,
  Corpus,
} from "../domain/bench.js"
import type { Chunk as DomainChunk } from "../domain/chunk.js"
import { DEFAULT_CONFIG } from "../domain/config.js"
import type { Config } from "../domain/config.js"
import type { EmbeddingDtype } from "../domain/dtype.js"
import type {
  AllConfigErrors,
  ChunkerError,
  AllProcessorErrors,
  DiskFullError,
} from "../domain/errors.js"
import { ConfigError, ModelLoadError } from "../domain/errors.js"
import { Display, Embedder, type EmbedderDeviceConfig } from "../domain/ports.js"
import { ConfigStore, Scanner, Chunker, ContentExtractor } from "../domain/ports.js"
import { formatTable, formatRecommendationMessage } from "../lib/bench/format.js"
import { getExtension } from "../lib/config/extension.js"
import { buildProcessorMap } from "../lib/config/processors.js"
import { mergeConfig } from "../lib/config/validation.js"
import { DeviceDetection } from "../services/device-detect.js"
import { MODEL_REGISTRY } from "../services/models.js"

type CorpusError = AllConfigErrors | ChunkerError | AllProcessorErrors | DiskFullError

const COLD_START_BATCH_SIZE = 16

const fisherYatesShuffle = <A>(arr: readonly A[]): Effect.Effect<A[]> =>
  Effect.gen(function* () {
    const result = [...arr]
    for (let i = result.length - 1; i > 0; i--) {
      const j = yield* Random.nextIntBetween(0, i + 1)
      const tmp = result[i]
      result[i] = result[j]
      result[j] = tmp
    }
    return result
  })

const cycleChunks = (chunks: readonly DomainChunk[], needed: number): DomainChunk[] => {
  if (chunks.length === 0) return []
  if (chunks.length >= needed) return chunks.slice(0, needed)
  const result: DomainChunk[] = []
  for (let i = 0; i < needed; i++) {
    result.push(chunks[i % chunks.length])
  }
  return result
}

const totalWork = (opts: BenchOptions): number => {
  const maxBatch = Math.max(...opts.batchSizes)
  return opts.warmup * maxBatch + opts.measureBatches * maxBatch
}

const computeRecommendation = (
  measurements: readonly BenchMeasurement[],
  profile: "throughput" | "cold" | "balanced",
): BenchRecommendation | null => {
  const ok = measurements.filter((m) => m.status === "ok")
  if (ok.length === 0) return null

  let best: BenchMeasurement
  if (profile === "throughput") {
    best = ok.reduce((a, b) => (a.warmChunksPerSec > b.warmChunksPerSec ? a : b))
  } else if (profile === "cold") {
    best = ok.reduce((a, b) => (a.coldLatencyMs < b.coldLatencyMs ? a : b))
  } else {
    const maxCold = Math.max(...ok.map((m) => m.coldLatencyMs))
    const minCold = Math.min(...ok.map((m) => m.coldLatencyMs))
    const maxWarm = Math.max(...ok.map((m) => m.warmChunksPerSec))
    const minWarm = Math.min(...ok.map((m) => m.warmChunksPerSec))

    const coldRange = maxCold - minCold || 1
    const warmRange = maxWarm - minWarm || 1

    best = ok.reduce((best, m) => {
      const coldScore = 1 - (m.coldLatencyMs - minCold) / coldRange
      const warmScore = (m.warmChunksPerSec - minWarm) / warmRange
      const score = 0.7 * coldScore + 0.3 * warmScore
      const bestColdScore = 1 - (best.coldLatencyMs - minCold) / coldRange
      const bestWarmScore = (best.warmChunksPerSec - minWarm) / warmRange
      const bestScore = 0.7 * bestColdScore + 0.3 * bestWarmScore
      return score > bestScore ? m : best
    })
  }

  return { device: best.device, batchSize: best.batchSize, profile }
}

export class BenchProject extends Effect.Service<BenchProject>()("BenchProject", {
  accessors: true,
  dependencies: [],
  effect: Effect.gen(function* () {
    const configStore = yield* ConfigStore
    const scanner = yield* Scanner
    const chunker = yield* Chunker
    const d = yield* Display
    const extractor = yield* ContentExtractor
    const embedder = yield* Embedder
    const detection = yield* DeviceDetection

    const prepareCorpus = (opts: BenchOptions): Effect.Effect<Corpus, CorpusError> =>
      Effect.gen(function* () {
        const hasConfig = yield* configStore.configExists()
        if (!hasConfig) {
          yield* configStore.writeConfig(DEFAULT_CONFIG)
        }
        const config = yield* configStore.readConfig()
        const eff = mergeConfig({}, config)
        const processorMap = buildProcessorMap(eff.skipExtensions)

        yield* d.updateInteractive("Scanning project files...")
        const scanResult = yield* scanner.scanFiles(eff.ignoredPaths, eff.ignoreGitignore)

        const knownFiles = scanResult.files.filter((file) => {
          const ext = getExtension(file)
          return processorMap[ext] !== undefined
        })

        if (knownFiles.length === 0) {
          yield* d.log("Found 0 chunks from 0 files", "info")
          return { chunks: [], fileCount: 0, chunkCount: 0 }
        }

        yield* d.updateInteractive(`Chunking ${knownFiles.length} files...`)
        const allChunks = yield* Stream.fromIterable(knownFiles).pipe(
          Stream.mapEffect(
            (file) =>
              extractor.extract(file).pipe(Effect.flatMap((text) => chunker.chunkText(text, file))),
            { concurrency: eff.concurrency },
          ),
          Stream.flatMap((chunks) => Stream.fromIterable(chunks)),
          Stream.runCollect,
          Effect.map(Chunk.toArray),
        )

        yield* d.updateInteractive("Shuffling chunks...")
        const shuffled = yield* fisherYatesShuffle(allChunks)

        const needed = totalWork(opts)
        const corpusChunks = cycleChunks(shuffled, needed)

        const uniqueCount = allChunks.length
        const cycledCount = corpusChunks.length
        const message =
          cycledCount > uniqueCount
            ? `Prepared ${cycledCount} chunks (${uniqueCount} unique, cycled) from ${knownFiles.length} files`
            : `Found ${cycledCount} chunks from ${knownFiles.length} files`
        yield* d.log(message, "info")

        return {
          chunks: corpusChunks,
          fileCount: knownFiles.length,
          chunkCount: corpusChunks.length,
        }
      })

    const getEmbedderConfig = (): Effect.Effect<
      { model: string; dtype: EmbeddingDtype; dims: number },
      ModelLoadError
    > =>
      Effect.gen(function* () {
        const config = yield* configStore
          .readConfig()
          .pipe(Effect.catchAll(() => Effect.succeed(undefined)))
        const model = config?.embedder.model ?? "Xenova/all-MiniLM-L6-v2"
        const dtype = (config?.embedder.dtype ?? "fp32") as EmbeddingDtype
        const modelInfo = MODEL_REGISTRY[model]
        if (!modelInfo) {
          return yield* new ModelLoadError({
            message: `Unknown embedding model "${model}"`,
            model,
          })
        }
        return { model, dtype, dims: modelInfo.dims }
      })

    const measureColdStart = (
      devCfg: EmbedderDeviceConfig,
      corpus: Corpus,
    ): Effect.Effect<{ latencyMs: number; error: string | undefined }, never> =>
      Effect.gen(function* () {
        const start = Date.now()
        const embedderResult = yield* embedder.createForDevice(devCfg).pipe(Effect.either)
        if (embedderResult._tag === "Left") {
          return { latencyMs: Date.now() - start, error: embedderResult.left.message }
        }
        const embedderInstance = embedderResult.right
        const batchTexts = corpus.chunks.slice(0, COLD_START_BATCH_SIZE).map((c) => c.text)
        if (batchTexts.length === 0) {
          yield* Effect.sleep("10 millis")
        } else {
          const batchResult = yield* embedderInstance.batch(batchTexts).pipe(Effect.either)
          if (batchResult._tag === "Left") {
            return { latencyMs: Date.now() - start, error: batchResult.left.message }
          }
        }
        return { latencyMs: Date.now() - start, error: undefined }
      }).pipe(Effect.orElseSucceed(() => ({ latencyMs: 0, error: "unexpected error" })))

    const measureWarmPath = (
      devCfg: EmbedderDeviceConfig,
      corpus: Corpus,
      batchSize: number,
      warmupBatches: number,
      measureBatches: number,
      timeoutMs: number,
    ): Effect.Effect<
      { chunksPerSec: number; latencyPerBatchMs: number; error: string | undefined },
      never
    > =>
      Effect.gen(function* () {
        const embedderResult = yield* embedder.createForDevice(devCfg).pipe(Effect.either)
        if (embedderResult._tag === "Left") {
          return { chunksPerSec: 0, latencyPerBatchMs: 0, error: embedderResult.left.message }
        }
        const embedderInstance = embedderResult.right

        const totalChunks = batchSize * measureBatches
        const availableChunks = corpus.chunks.length
        if (availableChunks < totalChunks) {
          return { chunksPerSec: 0, latencyPerBatchMs: 0, error: "insufficient corpus" }
        }

        for (let i = 0; i < warmupBatches; i++) {
          const offset = i * batchSize
          const texts = corpus.chunks.slice(offset, offset + batchSize).map((c) => c.text)
          const result = yield* embedderInstance.batch(texts).pipe(Effect.either)
          if (result._tag === "Left") {
            return { chunksPerSec: 0, latencyPerBatchMs: 0, error: result.left.message }
          }
        }

        const measureStart = Date.now()
        let totalLatency = 0

        for (let i = 0; i < measureBatches; i++) {
          const offset = (warmupBatches + i) * batchSize
          const texts = corpus.chunks.slice(offset, offset + batchSize).map((c) => c.text)
          const batchStart = Date.now()
          const result = yield* embedderInstance.batch(texts).pipe(Effect.either)
          if (result._tag === "Left") {
            return { chunksPerSec: 0, latencyPerBatchMs: 0, error: result.left.message }
          }
          totalLatency += Date.now() - batchStart
        }

        const totalMs = Date.now() - measureStart
        const chunksPerSec = totalMs > 0 ? (totalChunks / totalMs) * 1000 : 0
        const latencyPerBatchMs = measureBatches > 0 ? totalLatency / measureBatches : 0

        return { chunksPerSec, latencyPerBatchMs, error: undefined }
      }).pipe(
        Effect.timeout(`${timeoutMs} millis`),
        Effect.catchAll(() =>
          Effect.succeed({ chunksPerSec: 0, latencyPerBatchMs: 0, error: "timeout" }),
        ),
      )

    type BenchError = CorpusError | ModelLoadError

    const bench = (opts: BenchOptions): Effect.Effect<BenchResult, BenchError> =>
      Effect.gen(function* () {
        const corpus = yield* prepareCorpus(opts)

        if (corpus.chunks.length === 0) {
          return {
            profile: opts.profile,
            warmup: opts.warmup,
            measureBatches: opts.measureBatches,
            measurements: [],
            recommendation: { device: "cpu", batchSize: 16, profile: opts.profile },
          }
        }

        const ecfg = yield* getEmbedderConfig()
        const availableDevices = yield* detection.detectAll(ecfg.model, ecfg.dtype)

        if (availableDevices.length === 0) {
          return {
            profile: opts.profile,
            warmup: opts.warmup,
            measureBatches: opts.measureBatches,
            measurements: [],
            recommendation: { device: "cpu", batchSize: 16, profile: opts.profile },
          }
        }

        yield* d.log(`Available devices: ${availableDevices.join(", ")}`, "info")

        const totalSteps = availableDevices.length * (1 + opts.batchSizes.length)
        let currentStep = 0

        const measurements: BenchMeasurement[] = []

        yield* d.progress(
          {
            message: "Benchmarking devices...",
            max: totalSteps,
            style: "heavy",
            size: 40,
            indicator: "dots",
            stopMessage: "Benchmark complete",
          },
          Effect.gen(function* () {
            for (const device of availableDevices) {
              const devCfg: EmbedderDeviceConfig = {
                device,
                model: ecfg.model,
                dtype: ecfg.dtype,
                dims: ecfg.dims,
              }

              currentStep++
              yield* d.updateInteractive({
                message: `Cold-start: ${device} (${currentStep}/${totalSteps})`,
                advanceBy: 1,
              })

              const deviceStart = Date.now()
              const coldResult = yield* measureColdStart(devCfg, corpus)

              if (coldResult.error) {
                measurements.push({
                  device,
                  batchSize: 0,
                  coldLatencyMs: coldResult.latencyMs,
                  warmChunksPerSec: 0,
                  warmLatencyPerBatchMs: 0,
                  totalDurationMs: Date.now() - deviceStart,
                  status: "failed",
                  error: coldResult.error,
                })
                continue
              }

              for (const batchSize of opts.batchSizes) {
                currentStep++
                yield* d.updateInteractive({
                  message: `Warm-path: ${device} batchSize=${batchSize} (${currentStep}/${totalSteps})`,
                  advanceBy: 1,
                })

                const batchStart = Date.now()
                const warmResult = yield* measureWarmPath(
                  devCfg,
                  corpus,
                  batchSize,
                  opts.warmup,
                  opts.measureBatches,
                  opts.timeout * 1000,
                )

                const status: BenchStatus = warmResult.error ? "failed" : "ok"

                measurements.push({
                  device,
                  batchSize,
                  coldLatencyMs: coldResult.latencyMs,
                  warmChunksPerSec: warmResult.chunksPerSec,
                  warmLatencyPerBatchMs: warmResult.latencyPerBatchMs,
                  totalDurationMs: Date.now() - batchStart,
                  status,
                  error: warmResult.error,
                })
              }
            }

            const table = formatTable(measurements)
            yield* d.log(table, "info")

            const recommendation = computeRecommendation(measurements, opts.profile)
            if (recommendation) {
              yield* d.log(formatRecommendationMessage(recommendation), "success")
            } else {
              yield* d.log("No successful measurements to recommend from", "warn")
            }
          }),
        )

        return {
          profile: opts.profile,
          warmup: opts.warmup,
          measureBatches: opts.measureBatches,
          measurements,
          recommendation: computeRecommendation(measurements, opts.profile) ?? {
            device: "cpu",
            batchSize: 16,
            profile: opts.profile,
          },
        }
      })

    const applyConfig = (
      recommendation: BenchRecommendation,
    ): Effect.Effect<void, ConfigError | DiskFullError | AllConfigErrors> =>
      Effect.gen(function* () {
        const { device, batchSize } = recommendation

        const hasConfig = yield* configStore.configExists()
        const currentConfig = hasConfig ? yield* configStore.readConfig() : DEFAULT_CONFIG

        const updated: Config = {
          ...currentConfig,
          embedder: {
            ...currentConfig.embedder,
            device,
            batchSize,
          },
        }

        yield* configStore.writeConfig(updated)
        yield* d.log(
          `Applied: device=${device}, batchSize=${batchSize} to .pix/config.json`,
          "success",
        )
      })

    return { bench, prepareCorpus, applyConfig }
  }),
}) {}
