import { Effect, Random, Stream } from "effect"
import * as Chunk from "effect/Chunk"

import type { BenchOptions, BenchResult, Corpus } from "../domain/bench.js"
import type { Chunk as DomainChunk } from "../domain/chunk.js"
import { DEFAULT_CONFIG } from "../domain/config.js"
import type {
  AllConfigErrors,
  ChunkerError,
  AllProcessorErrors,
  DiskFullError,
} from "../domain/errors.js"
import { Display } from "../domain/ports.js"
import { ConfigStore, Scanner, Chunker, ContentExtractor } from "../domain/ports.js"
import { getExtension } from "../lib/config/extension.js"
import { buildProcessorMap } from "../lib/config/processors.js"
import { mergeConfig } from "../lib/config/validation.js"

type CorpusError = AllConfigErrors | ChunkerError | AllProcessorErrors | DiskFullError

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

export class BenchProject extends Effect.Service<BenchProject>()("BenchProject", {
  accessors: true,
  dependencies: [],
  effect: Effect.gen(function* () {
    const configStore = yield* ConfigStore
    const scanner = yield* Scanner
    const chunker = yield* Chunker
    const d = yield* Display
    const extractor = yield* ContentExtractor

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

    const bench = (opts: BenchOptions): Effect.Effect<BenchResult, CorpusError> =>
      Effect.gen(function* () {
        yield* prepareCorpus(opts)

        return {
          profile: opts.profile,
          warmup: opts.warmup,
          measureBatches: opts.measureBatches,
          measurements: [],
          recommendation: "measurement pipeline not yet implemented",
        }
      })

    return { bench, prepareCorpus }
  }),
}) {}
