import { Clock, Context, Effect, Layer, Random, Result, Stream } from "effect"

import type {
  BenchMeasurement,
  BenchOptions,
  BenchRecommendation,
  BenchResult,
  Corpus,
} from "../domain/bench.js"
import type { Chunk as DomainChunk } from "../domain/chunk.js"
import { DEFAULT_CONFIG } from "../domain/config.js"
import type { Config } from "../domain/config.js"
import { DEVICE_PRIORITY, type DeviceType } from "../domain/device.js"
import type {
  AllConfigErrors,
  AllEmbedderErrors,
  AllProcessorErrors,
  DiskFullError,
} from "../domain/errors.js"
import { ConfigError, ModelLoadError } from "../domain/errors.js"
import {
  ConfigStore,
  Scanner,
  Chunker,
  ContentExtractor,
  DeviceDetection,
  Display,
  Embedder,
  SparseEmbedder,
  type EmbedderDeviceConfig,
} from "../domain/ports.js"
import { computeRecommendations, computeRecommendation } from "../lib/bench/format.js"
import { getExtension } from "../lib/config/extension.js"
import { mergeConfig } from "../lib/config/validation.js"
import { resolveEmbedderConfig } from "../lib/embedder/resolve.js"
import { buildExtensionRegistry } from "../lib/registry.js"
import { createTokenAwareChunking } from "../lib/token-count.js"

type CorpusError = AllConfigErrors | AllEmbedderErrors | AllProcessorErrors | DiskFullError

const COLD_START_BATCH_SIZE = 16

const elapsedMillis = (start: bigint, end: bigint): number => Number(end - start) / 1_000_000

type BenchmarkBatcher = {
  readonly batch: (texts: readonly string[]) => Effect.Effect<readonly object[], AllEmbedderErrors>
}

type CreateBenchmarkBatcher = (
  device: DeviceType,
  batchSize: number,
) => Effect.Effect<BenchmarkBatcher, ModelLoadError>

const fisherYatesShuffle = <A>(arr: readonly A[]): Effect.Effect<A[]> =>
  Effect.gen(function* () {
    const result = [...arr]
    for (let i = result.length - 1; i > 0; i--) {
      const j = yield* Random.nextIntBetween(0, i)
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
  const sparseBatchSizes = opts.sparseBatchSizes ?? opts.batchSizes
  const maxBatch = Math.max(...opts.batchSizes, ...sparseBatchSizes)
  return opts.warmup * maxBatch + opts.measureBatches * maxBatch
}

type BenchError = CorpusError

export class BenchProject extends Context.Service<
  BenchProject,
  {
    readonly bench: (opts: BenchOptions) => Effect.Effect<BenchResult, BenchError>
    readonly prepareCorpus: (opts: BenchOptions) => Effect.Effect<Corpus, CorpusError>
    readonly applyConfig: (
      recommendation: BenchRecommendation,
      sparseRecommendation?: BenchRecommendation,
    ) => Effect.Effect<void, ConfigError | DiskFullError | AllConfigErrors>
  }
>()("BenchProject") {}

const make = Effect.gen(function* () {
  const configStore = yield* ConfigStore
  const scanner = yield* Scanner
  const chunker = yield* Chunker
  const d = yield* Display
  const extractor = yield* ContentExtractor
  const embedder = yield* Embedder
  const sparseEmbedder = yield* SparseEmbedder
  const detection = yield* DeviceDetection

  const prepareCorpus = (opts: BenchOptions): Effect.Effect<Corpus, CorpusError> =>
    Effect.gen(function* () {
      const hasConfig = yield* configStore.configExists()
      if (!hasConfig) {
        yield* configStore.writeConfig(DEFAULT_CONFIG)
      }
      const config = yield* configStore.readConfig()
      const eff = mergeConfig({}, config)
      const { maxTokens, countTokens } = createTokenAwareChunking(
        eff.chunkTokens,
        embedder,
        sparseEmbedder,
      )
      const extensionRegistry = buildExtensionRegistry(eff.skipExtensions)
      const skippedSet = new Set(eff.skipExtensions)

      yield* d.updateInteractive("Scanning project files...")
      const scanResult = yield* scanner.scanFiles(eff.ignoredPaths, eff.ignoreGitignore)

      const knownFiles = scanResult.files.filter((file) => {
        // buildExtensionRegistry materializes skipped extensions as entries
        // (with a fail-fast processor), so a presence check is no longer
        // enough to distinguish "known" from "user-skipped". Filter the
        // skip set explicitly so the benchmark corpus matches the real
        // indexing corpus.
        const ext = getExtension(file.path)
        if (skippedSet.has(ext)) return false
        return extensionRegistry[ext] !== undefined
      })

      if (knownFiles.length === 0) {
        yield* d.log("Found 0 chunks from 0 files", "info")
        return { chunks: [], fileCount: 0, chunkCount: 0 }
      }

      yield* d.updateInteractive(`Chunking ${knownFiles.length} files...`)
      const allChunks = yield* Stream.fromIterable(knownFiles).pipe(
        Stream.mapEffect(
          (file) =>
            extractor.extract(file.path).pipe(
              Effect.flatMap((text) =>
                chunker.chunkText(text, file.path, {
                  maxTokens,
                  overlapLines: config.overlapLines,
                  countTokens,
                  onDiagnostic: () => Effect.void,
                }),
              ),
            ),
          { concurrency: eff.concurrency },
        ),
        Stream.flatMap((chunks) => Stream.fromIterable(chunks)),
        Stream.runCollect,
        Effect.timeout("5 minutes"),
        Effect.catch((e) =>
          e._tag === "TimeoutError"
            ? Effect.fail(new ConfigError({ message: "Chunking timed out after 5 minutes" }))
            : Effect.fail(e as CorpusError),
        ),
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

  const measureColdStart = (
    createBatcher: CreateBenchmarkBatcher,
    device: DeviceType,
    corpus: Corpus,
    batchSize: number,
  ): Effect.Effect<{ latencyMs: number; error: string | undefined }, never> =>
    Effect.gen(function* () {
      const start = yield* Clock.currentTimeNanos
      const batcherResult = yield* createBatcher(device, batchSize).pipe(Effect.result)
      if (Result.isFailure(batcherResult)) {
        const end = yield* Clock.currentTimeNanos
        return { latencyMs: elapsedMillis(start, end), error: batcherResult.failure.message }
      }
      const coldBatchSize = Math.min(COLD_START_BATCH_SIZE, batchSize)
      const batchTexts = corpus.chunks.slice(0, coldBatchSize).map((c) => c.text)
      if (batchTexts.length === 0) {
        yield* Effect.sleep("10 millis")
      } else {
        const batchResult = yield* batcherResult.success.batch(batchTexts).pipe(Effect.result)
        if (Result.isFailure(batchResult)) {
          const end = yield* Clock.currentTimeNanos
          return { latencyMs: elapsedMillis(start, end), error: batchResult.failure.message }
        }
      }
      const end = yield* Clock.currentTimeNanos
      return { latencyMs: elapsedMillis(start, end), error: undefined }
    }).pipe(Effect.orElseSucceed(() => ({ latencyMs: 0, error: "unexpected error" })))

  const measureWarmPath = (
    createBatcher: CreateBenchmarkBatcher,
    device: DeviceType,
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
      const batcherResult = yield* createBatcher(device, batchSize).pipe(Effect.result)
      if (Result.isFailure(batcherResult)) {
        return { chunksPerSec: 0, latencyPerBatchMs: 0, error: batcherResult.failure.message }
      }
      const batcher = batcherResult.success

      const totalChunks = batchSize * measureBatches
      const availableChunks = corpus.chunks.length
      if (availableChunks < totalChunks) {
        return { chunksPerSec: 0, latencyPerBatchMs: 0, error: "insufficient corpus" }
      }

      for (let i = 0; i < warmupBatches; i++) {
        const offset = i * batchSize
        const texts = corpus.chunks.slice(offset, offset + batchSize).map((c) => c.text)
        const result = yield* batcher.batch(texts).pipe(Effect.result)
        if (Result.isFailure(result)) {
          return { chunksPerSec: 0, latencyPerBatchMs: 0, error: result.failure.message }
        }
      }

      const measureStart = yield* Clock.currentTimeNanos
      let totalLatency = 0

      for (let i = 0; i < measureBatches; i++) {
        const offset = (warmupBatches + i) * batchSize
        const texts = corpus.chunks.slice(offset, offset + batchSize).map((c) => c.text)
        const batchStart = yield* Clock.currentTimeNanos
        const result = yield* batcher.batch(texts).pipe(Effect.result)
        if (Result.isFailure(result)) {
          return { chunksPerSec: 0, latencyPerBatchMs: 0, error: result.failure.message }
        }
        const batchEnd = yield* Clock.currentTimeNanos
        totalLatency += elapsedMillis(batchStart, batchEnd)
      }

      const measureEnd = yield* Clock.currentTimeNanos
      const totalMs = Math.max(elapsedMillis(measureStart, measureEnd), 1)
      const chunksPerSec = totalMs > 0 ? (totalChunks / totalMs) * 1000 : 0
      const latencyPerBatchMs = measureBatches > 0 ? totalLatency / measureBatches : 0

      return { chunksPerSec, latencyPerBatchMs, error: undefined }
    }).pipe(
      Effect.timeout(`${timeoutMs} millis`),
      Effect.catch(() =>
        Effect.succeed({ chunksPerSec: 0, latencyPerBatchMs: 0, error: "timeout" }),
      ),
    )

  const bench = (opts: BenchOptions): Effect.Effect<BenchResult, BenchError> =>
    Effect.gen(function* () {
      const corpus = yield* prepareCorpus(opts)

      if (corpus.chunks.length === 0) {
        return {
          profile: opts.profile,
          warmup: opts.warmup,
          measureBatches: opts.measureBatches,
          measurements: [],
          sparseMeasurements: [],
          recommendation: { device: "cpu", batchSize: 8, profile: opts.profile },
          sparseRecommendation: { device: "cpu", batchSize: 2, profile: opts.profile },
        }
      }

      const ecfg = yield* resolveEmbedderConfig(configStore)
      const requestedDevices = opts.devices ?? DEVICE_PRIORITY
      const availableDevices =
        opts.devices === undefined
          ? yield* detection.detectAll(ecfg.model, ecfg.dtype)
          : requestedDevices
      const sparseBatchSizes = opts.sparseBatchSizes ?? opts.batchSizes
      yield* d.log(
        `${opts.devices === undefined ? "Available" : "Selected"} Dense devices: ${
          availableDevices.length > 0 ? availableDevices.join(", ") : "none"
        }`,
        "info",
      )
      yield* d.log(`Sparse devices to probe: ${requestedDevices.join(", ")}`, "info")

      const totalSteps =
        availableDevices.length * (1 + opts.batchSizes.length) +
        requestedDevices.length * (1 + sparseBatchSizes.length)
      let currentStep = 0

      const createDenseBatcher: CreateBenchmarkBatcher = (device, batchSize) => {
        const devCfg: EmbedderDeviceConfig = {
          device,
          model: ecfg.model,
          dtype: ecfg.dtype,
          dims: ecfg.dims,
          batchSize,
        }
        return embedder
          .createForDevice(devCfg)
          .pipe(Effect.map((bound) => ({ batch: bound.batch }) satisfies BenchmarkBatcher))
      }
      const createSparseBatcher: CreateBenchmarkBatcher = (device, batchSize) =>
        sparseEmbedder
          .createForDevice({ device, batchSize })
          .pipe(Effect.map((bound) => ({ batch: bound.batch }) satisfies BenchmarkBatcher))

      const benchmarkChannel = (
        label: string,
        devices: readonly DeviceType[],
        batchSizes: readonly number[],
        createBatcher: CreateBenchmarkBatcher,
      ): Effect.Effect<BenchMeasurement[], never> =>
        Effect.gen(function* () {
          const measurements: BenchMeasurement[] = []
          const coldBatchSize = Math.min(COLD_START_BATCH_SIZE, Math.max(1, ...batchSizes))

          for (const device of devices) {
            currentStep++
            yield* d.updateInteractive({
              message: `${label} cold-start: ${device} (${currentStep}/${totalSteps})`,
              advanceBy: 1,
            })

            const deviceStart = yield* Clock.currentTimeNanos
            const coldResult = yield* measureColdStart(createBatcher, device, corpus, coldBatchSize)

            if (coldResult.error) {
              measurements.push({
                device,
                batchSize: 0,
                coldLatencyMs: coldResult.latencyMs,
                warmChunksPerSec: 0,
                warmLatencyPerBatchMs: 0,
                totalDurationMs: elapsedMillis(deviceStart, yield* Clock.currentTimeNanos),
                status: "failed",
                error: coldResult.error,
              })
              continue
            }

            for (const batchSize of batchSizes) {
              currentStep++
              yield* d.updateInteractive({
                message: `${label} warm-path: ${device} batchSize=${batchSize} (${currentStep}/${totalSteps})`,
                advanceBy: 1,
              })

              const batchStart = yield* Clock.currentTimeNanos
              const warmResult = yield* measureWarmPath(
                createBatcher,
                device,
                corpus,
                batchSize,
                opts.warmup,
                opts.measureBatches,
                opts.timeout * 1000,
              )

              measurements.push({
                device,
                batchSize,
                coldLatencyMs: coldResult.latencyMs,
                warmChunksPerSec: warmResult.chunksPerSec,
                warmLatencyPerBatchMs: warmResult.latencyPerBatchMs,
                totalDurationMs: elapsedMillis(batchStart, yield* Clock.currentTimeNanos),
                status: warmResult.error ? "failed" : "ok",
                error: warmResult.error ?? null,
              })
            }
          }

          return measurements
        })

      const renderChannel = (label: string, measurements: readonly BenchMeasurement[]) =>
        Effect.gen(function* () {
          const header = ["device", "batchSize", "cold (ms)", "warm (ch/s)", "time (ms)", "status"]
          const rows = measurements.map((m) => [
            m.device,
            m.status === "failed" && m.batchSize === 0 ? "—" : String(m.batchSize),
            String(Math.round(m.coldLatencyMs)),
            m.status === "ok" ? String(Math.round(m.warmChunksPerSec)) : "—",
            String(Math.round(m.totalDurationMs)),
            m.status,
          ])
          yield* d.table(header, rows)

          const recs = computeRecommendations(measurements, opts.profile)
          if (recs.length === 0) {
            yield* d.log(`No successful measurements to recommend from (${label})`, "warn")
          } else {
            for (const rec of recs) {
              yield* d.log(`${label}: ${rec.label}`, rec.isRecommended ? "success" : "info")
            }
          }
        })

      const { denseMeasurements, sparseMeasurements } = yield* d.progress(
        {
          message: "Benchmarking devices...",
          max: totalSteps,
          style: "heavy",
          size: 40,
          indicator: "dots",
          stopMessage: "Benchmark complete",
        },
        Effect.gen(function* () {
          const denseMeasurements = yield* benchmarkChannel(
            "Dense",
            availableDevices,
            opts.batchSizes,
            createDenseBatcher,
          )
          const sparseMeasurements = yield* benchmarkChannel(
            "Sparse",
            requestedDevices,
            sparseBatchSizes,
            createSparseBatcher,
          )
          yield* renderChannel("Dense", denseMeasurements)
          yield* renderChannel("Sparse", sparseMeasurements)
          return { denseMeasurements, sparseMeasurements }
        }),
      )

      return {
        profile: opts.profile,
        warmup: opts.warmup,
        measureBatches: opts.measureBatches,
        measurements: denseMeasurements,
        sparseMeasurements,
        recommendation: computeRecommendation(denseMeasurements, opts.profile) ?? {
          device: "cpu",
          batchSize: 8,
          profile: opts.profile,
        },
        sparseRecommendation: computeRecommendation(sparseMeasurements, opts.profile) ?? {
          device: "cpu",
          batchSize: 2,
          profile: opts.profile,
        },
      }
    })

  const applyConfig = (
    recommendation: BenchRecommendation,
    sparseRecommendation?: BenchRecommendation,
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
        sparseEmbedder: sparseRecommendation
          ? {
              ...currentConfig.sparseEmbedder,
              device: sparseRecommendation.device,
              batchSize: sparseRecommendation.batchSize,
            }
          : currentConfig.sparseEmbedder,
      }

      yield* configStore.writeConfig(updated)
      yield* d.log(
        `Applied: device=${device}, batchSize=${batchSize}${
          sparseRecommendation
            ? `, sparseDevice=${sparseRecommendation.device}, sparseBatchSize=${sparseRecommendation.batchSize}`
            : ""
        } to .pix/config.json`,
        "success",
      )
    })

  return { bench, prepareCorpus, applyConfig }
})

export const BenchProjectLive = Layer.effect(BenchProject, make)
