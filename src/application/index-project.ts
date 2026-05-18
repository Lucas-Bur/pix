import { Effect, Ref, Stream, Option } from "effect"
import * as Chunk from "effect/Chunk"

import type { Chunk as DomainChunk } from "../domain/chunk.js"
import { DEFAULT_CONFIG } from "../domain/config.js"
import type { IndexError, AllProcessorErrors, ChunkerError } from "../domain/errors.js"
import { Display } from "../domain/ports.js"
import {
  ConfigStore,
  Scanner,
  Chunker,
  Embedder,
  IndexStore,
  ContentExtractor,
  type SkippedEntry,
  type IndexOptions,
} from "../domain/ports.js"
import { getExtension, getFileExtension, getFilename } from "../lib/config/extension.js"
import { buildProcessorMap } from "../lib/config/processors.js"
import { mergeConfig } from "../lib/config/validation.js"
import type { StatusResult } from "./get-status.js"

export interface IndexResult {
  readonly success: true
  readonly status: Omit<StatusResult, "model" | "lastIndex">
  readonly durationMs: number
  readonly embedderFallback?: {
    readonly originalDevice: string
    readonly reason: string
  }
}

interface FileClassification {
  readonly knownFiles: string[]
  readonly skippedFiles: string[]
  readonly unknownExtensions: Set<string>
}

const classifyFiles = (
  files: readonly string[],
  processorMap: Record<string, unknown>,
): FileClassification => {
  const knownFiles: string[] = []
  const skippedFiles: string[] = []
  const unknownExtensions = new Set<string>()

  for (const file of files) {
    const ext = getExtension(file)
    const proc = processorMap[ext]
    if (!proc) {
      unknownExtensions.add(ext)
      skippedFiles.push(file)
    } else {
      knownFiles.push(file)
    }
  }

  return { knownFiles, skippedFiles, unknownExtensions }
}

interface ExtractedFile {
  readonly file: string
  readonly text: string
}

interface Phase1Result {
  readonly chunks: DomainChunk[]
  readonly totalChunks: number
}

const classifyAndCollectChunks = (
  knownFiles: string[],
  extractor: typeof ContentExtractor.Service,
  chunker: typeof Chunker.Service,
  concurrency: number,
  skipped: Ref.Ref<readonly SkippedEntry[]>,
): Effect.Effect<Phase1Result, AllProcessorErrors | ChunkerError> =>
  Stream.fromIterable(knownFiles).pipe(
    Stream.mapEffect(
      (file) =>
        extractor.extract(file).pipe(
          Effect.flatMap((text) =>
            Effect.succeed<Option.Option<ExtractedFile>>(Option.some({ file, text })),
          ),
          Effect.catchAll((err) =>
            Ref.update(skipped, (prev) => [...prev, { path: file, reason: err.message }]).pipe(
              Effect.flatMap(() => Effect.succeed<Option.Option<ExtractedFile>>(Option.none())),
            ),
          ),
        ),
      { concurrency },
    ),
    Stream.filterMap((opt: Option.Option<ExtractedFile>) => opt),
    Stream.mapEffect(({ file, text }) => chunker.chunkText(text, file), { concurrency }),
    Stream.flatMap((chunks) => Stream.fromIterable(chunks)),
    Stream.runCollect,
    Effect.map((allChunks) => {
      const chunks = Chunk.toArray(allChunks)
      return { chunks, totalChunks: chunks.length }
    }),
  )

export class IndexProject extends Effect.Service<IndexProject>()("IndexProject", {
  accessors: true,
  effect: Effect.gen(function* () {
    const configStore = yield* ConfigStore
    const scanner = yield* Scanner
    const chunker = yield* Chunker
    const embedder = yield* Embedder
    const indexStore = yield* IndexStore
    const d = yield* Display
    const extractor = yield* ContentExtractor

    interface IndexContext {
      readonly eff: ReturnType<typeof mergeConfig>
      readonly knownFiles: string[]
      readonly skipped: Ref.Ref<readonly SkippedEntry[]>
      readonly start: number
    }

    const prepareIndexContext = (opts: IndexOptions): Effect.Effect<IndexContext, IndexError> =>
      Effect.gen(function* () {
        const hasConfig = yield* configStore.configExists()
        if (!hasConfig) {
          yield* configStore.writeConfig(DEFAULT_CONFIG)
        }
        const config = yield* configStore.readConfig()
        const eff = mergeConfig(opts, config)
        const processorMap = buildProcessorMap(eff.skipExtensions)

        yield* d.updateInteractive("Scanning source files...")
        const scanResult = yield* scanner.scanFiles(eff.ignoredPaths, eff.ignoreGitignore)

        const { knownFiles, skippedFiles, unknownExtensions } = classifyFiles(
          scanResult.files,
          processorMap,
        )

        const skipped = yield* Ref.make<readonly SkippedEntry[]>(
          scanResult.skipped
            .filter((s) => !s.reason.startsWith("Ignored by config pattern"))
            .map((s) => ({ path: s.path, reason: s.reason })),
        )

        if (unknownExtensions.size > 0) {
          yield* Ref.update(skipped, (prev) => [
            ...prev,
            ...skippedFiles.map((f) => ({
              path: f,
              reason: "unknown extension",
            })),
          ])
        }

        return { eff, knownFiles, skipped, start: Date.now() }
      })

    const scanAndChunkFiles = (ctx: IndexContext): Effect.Effect<Phase1Result, IndexError> =>
      Effect.gen(function* () {
        if (ctx.knownFiles.length === 0) {
          return { chunks: [], totalChunks: 0 }
        }

        yield* d.updateInteractive(`Processing ${ctx.knownFiles.length} files...`)
        return yield* classifyAndCollectChunks(
          ctx.knownFiles,
          extractor,
          chunker,
          ctx.eff.concurrency,
          ctx.skipped,
        )
      })

    const embedAndPersistChunks = (
      ctx: IndexContext,
      chunks: DomainChunk[],
      totalChunks: number,
    ): Effect.Effect<
      { chunks: number; files: number; totalLines: number; byteSize: number },
      IndexError
    > =>
      Effect.gen(function* () {
        yield* indexStore.storeBegin()
        const embeddedRef = yield* Ref.make(0)

        return yield* d.progress(
          { message: `Embedding ${totalChunks} chunks...`, max: totalChunks },
          Stream.fromIterable(chunks).pipe(
            Stream.grouped(ctx.eff.batchSize),
            Stream.mapEffect((batchChunk) =>
              Effect.gen(function* () {
                const batch = Chunk.toArray(batchChunk)
                const texts = batch.map((c: DomainChunk) => c.text)
                const embeddings = yield* embedder.batch(texts)
                yield* indexStore.storeBatch(batch, embeddings)
                const count = yield* Ref.updateAndGet(embeddedRef, (n) => n + batch.length)
                yield* d.updateInteractive({
                  message: `Embedding ${count} of ${totalChunks} chunks`,
                  setTo: count,
                })
              }),
            ),
            Stream.runDrain,
            Effect.matchEffect({
              onSuccess: () => indexStore.storeCommit(),
              onFailure: (err) =>
                indexStore.storeAbort().pipe(Effect.ignore, Effect.andThen(Effect.fail(err))),
            }),
          ),
        )
      })

    const buildIndexResult = (
      stats: { chunks: number; files: number; totalLines: number; byteSize: number },
      skipped: Ref.Ref<readonly SkippedEntry[]>,
      start: number,
    ): Effect.Effect<IndexResult> =>
      Effect.gen(function* () {
        const collected = yield* Ref.get(skipped)
        yield* displaySkippedNote(d, collected)

        const durationSec = ((Date.now() - start) / 1000).toFixed(1)
        yield* d.log(
          `Indexed ${stats.chunks} chunks from ${stats.files} files in ${durationSec}s`,
          "success",
        )

        const fallbackInfo = yield* embedder.getFallbackInfo()

        return {
          success: true as const,
          status: {
            chunks: stats.chunks,
            files: stats.files,
            totalLines: stats.totalLines,
            byteSize: stats.byteSize,
            validationErrors: [],
          },
          durationMs: Date.now() - start,
          embedderFallback: fallbackInfo,
        }
      })

    const index = (opts: IndexOptions = {}): Effect.Effect<IndexResult, IndexError> =>
      Effect.gen(function* () {
        const ctx = yield* prepareIndexContext(opts)

        const phase1 = yield* scanAndChunkFiles(ctx)
        if (phase1.totalChunks === 0) {
          return yield* emptyIndexResult(d, ctx.skipped, ctx.start)
        }

        const stats = yield* embedAndPersistChunks(ctx, phase1.chunks, phase1.totalChunks)
        return yield* buildIndexResult(stats, ctx.skipped, ctx.start)
      })

    return { index }
  }),
}) {}

const groupByExtension = (entries: readonly SkippedEntry[]): Map<string, string[]> => {
  const byExt = new Map<string, string[]>()
  for (const s of entries) {
    const name = getFilename(s.path)
    const ext = getFileExtension(name)
    if (!byExt.has(ext)) byExt.set(ext, [])
    byExt.get(ext)!.push(name)
  }
  return byExt
}

const formatFileList = (files: string[], maxDisplay = 5): string =>
  files.length > maxDisplay
    ? `${files.slice(0, maxDisplay).join(", ")} +${files.length - maxDisplay} more`
    : files.join(", ")

const buildSkippedLines = (
  extFailures: readonly SkippedEntry[],
  extractErrors: readonly SkippedEntry[],
): string[] => {
  const lines: string[] = []

  if (extFailures.length > 0) {
    lines.push(`Unknown extensions (${extFailures.length})`)
    for (const [ext, files] of groupByExtension(extFailures)) {
      lines.push(`  ${ext} (${files.length}): ${formatFileList(files)}`)
    }
  }

  if (extractErrors.length > 0) {
    if (lines.length > 0) lines.push("")
    lines.push(`Extraction errors (${extractErrors.length})`)
    for (const s of extractErrors) {
      lines.push(`  ${getFilename(s.path)}: ${s.reason}`)
    }
  }

  return lines
}

const emptyIndexResult = (
  d: typeof Display.Service,
  skipped: Ref.Ref<readonly SkippedEntry[]>,
  start: number,
): Effect.Effect<IndexResult> =>
  Effect.gen(function* () {
    const collected = yield* Ref.get(skipped)
    yield* displaySkippedNote(d, collected)
    return {
      success: true as const,
      status: { chunks: 0, files: 0, totalLines: 0, byteSize: 0, validationErrors: [] },
      durationMs: Date.now() - start,
    }
  })

const displaySkippedNote = (
  d: typeof Display.Service,
  skipped: readonly SkippedEntry[],
): Effect.Effect<void> => {
  if (skipped.length === 0) return Effect.void

  const extFailures = skipped.filter((s) => s.reason === "unknown extension")
  const extractErrors = skipped.filter((s) => s.reason !== "unknown extension")

  return d.note(
    buildSkippedLines(extFailures, extractErrors).join("\n"),
    `Skipped ${skipped.length} files`,
  )
}
