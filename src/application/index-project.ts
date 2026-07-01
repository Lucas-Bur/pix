import { Context, Effect, Layer, Ref, Stream } from "effect"

import type { Chunk as DomainChunk } from "../domain/chunk.js"
import { DEFAULT_CONFIG } from "../domain/config.js"
import type { IndexError, AllProcessorErrors, ChunkerError } from "../domain/errors.js"
import type { IdentifierIndexMaps } from "../domain/identifier-index.js"
import type { Identifier } from "../domain/identifier.js"
import { Display } from "../domain/ports.js"
import {
  ConfigStore,
  Scanner,
  Chunker,
  Embedder,
  IndexStore,
  ContentExtractor,
  IdentifierExtractor,
  type SkippedEntry,
  type IndexOptions,
} from "../domain/ports.js"
import { getExtension, getFileExtension, getFilename } from "../lib/config/extension.js"
import { mergeConfig } from "../lib/config/validation.js"
import { buildExtensionRegistry } from "../lib/registry.js"
import { buildIdentifierIndex } from "../lib/retrieval/identifier-index.js"
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
  extensionRegistry: Record<string, unknown>,
  skipExtensions: ReadonlySet<string>,
): FileClassification => {
  const knownFiles: string[] = []
  const skippedFiles: string[] = []
  const unknownExtensions = new Set<string>()

  for (const file of files) {
    const ext = getExtension(file)
    // buildExtensionRegistry materializes skipped extensions as entries
    // (with a fail-fast processor). A presence check on the registry is
    // therefore no longer enough to distinguish "known to pix" from
    // "user explicitly skipped". Filter the skip set first.
    if (skipExtensions.has(ext)) {
      skippedFiles.push(file)
      continue
    }
    const entry = extensionRegistry[ext]
    if (!entry) {
      unknownExtensions.add(ext)
      skippedFiles.push(file)
    } else {
      knownFiles.push(file)
    }
  }

  return { knownFiles, skippedFiles, unknownExtensions }
}

interface Phase1Result {
  readonly chunks: DomainChunk[]
  readonly totalChunks: number
}

const classifyAndCollectChunks = (
  knownFiles: string[],
  extractor: typeof ContentExtractor.Service,
  chunker: typeof Chunker.Service,
  skipped: Ref.Ref<readonly SkippedEntry[]>,
): Effect.Effect<Phase1Result, AllProcessorErrors | ChunkerError> =>
  Effect.gen(function* () {
    const allChunks: DomainChunk[] = []
    for (const file of knownFiles) {
      const result = yield* extractor.extract(file).pipe(
        Effect.map((text) => ({ kind: "ok" as const, file, text })),
        Effect.catch((err) =>
          Ref.update(skipped, (prev) => [...prev, { path: file, reason: err.message }]).pipe(
            Effect.map(() => ({ kind: "skip" as const })),
          ),
        ),
      )
      if (result.kind !== "ok") continue
      const chunks = yield* chunker
        .chunkText(result.text, result.file)
        .pipe(
          Effect.catch((err) =>
            Ref.update(skipped, (prev) => [...prev, { path: file, reason: err.message }]).pipe(
              Effect.map((): DomainChunk[] => []),
            ),
          ),
        )
      allChunks.push(...chunks)
    }
    return { chunks: allChunks, totalChunks: allChunks.length }
  })

export class IndexProject extends Context.Service<
  IndexProject,
  {
    readonly index: (opts?: IndexOptions) => Effect.Effect<IndexResult, IndexError>
  }
>()("IndexProject") {}

const make = Effect.gen(function* () {
  const configStore = yield* ConfigStore
  const scanner = yield* Scanner
  const chunker = yield* Chunker
  const embedder = yield* Embedder
  const indexStore = yield* IndexStore
  const d = yield* Display
  const extractor = yield* ContentExtractor
  const identifierExtractor = yield* IdentifierExtractor

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
      const extensionRegistry = buildExtensionRegistry(eff.skipExtensions)

      yield* d.updateInteractive("Scanning source files...")
      const scanResult = yield* scanner.scanFiles(eff.ignoredPaths, eff.ignoreGitignore)

      const { knownFiles, skippedFiles, unknownExtensions } = classifyFiles(
        scanResult.files,
        extensionRegistry,
        new Set(eff.skipExtensions),
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
      return yield* classifyAndCollectChunks(ctx.knownFiles, extractor, chunker, ctx.skipped)
    })

  /**
   * Walk all chunks and extract code identifiers via the IdentifierExtractor. Re-parses each chunk
   * independently (the chunker's overlap means the same identifier can appear in multiple chunks --
   * the build step aggregates those occurrences into the maps). The chunk's file path drives parser
   * dispatch inside the service.
   *
   * The `globalIndex` passed to the extractor is the chunk's position in the `phase1.chunks` array,
   * NOT `chunk.idx` (which is the per-file chunk position). The identifier scorers look up entries
   * by their global index in the loaded search data; using `chunk.idx` here would cause per-file
   * collisions where two different files' chunks (both at per-file `idx 0`) would map to the same
   * global entry, biasing results toward whichever file was indexed first.
   */
  const extractIdentifiersForChunks = (
    chunks: readonly DomainChunk[],
  ): Effect.Effect<IdentifierIndexMaps, never> =>
    Effect.gen(function* () {
      const all: Identifier[] = []
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i]
        const ids = yield* identifierExtractor.extractIdentifiers(chunk.file, chunk.text, i)
        for (const id of ids) all.push(id)
      }
      return buildIdentifierIndex(all)
    })

  const embedAndPersistChunks = (
    ctx: IndexContext,
    chunks: DomainChunk[],
    totalChunks: number,
    identifierIndex: IdentifierIndexMaps,
  ): Effect.Effect<
    { chunks: number; files: number; totalLines: number; byteSize: number },
    IndexError
  > =>
    Effect.gen(function* () {
      const embeddedRef = yield* Ref.make(0)

      return yield* d.progress(
        { message: `Embedding ${totalChunks} chunks...`, max: totalChunks },
        indexStore.persistIndex({
          chunks: Stream.fromIterable(chunks).pipe(
            Stream.grouped(ctx.eff.batchSize),
            Stream.mapEffect((batch: readonly DomainChunk[]) =>
              Effect.gen(function* () {
                const texts = batch.map((c: DomainChunk) => c.text)
                const embeddings = yield* embedder.batch(texts)
                const count = yield* Ref.updateAndGet(embeddedRef, (n) => n + batch.length)
                yield* d.updateInteractive({
                  message: `Embedding ${count} of ${totalChunks} chunks`,
                  setTo: count,
                })
                return batch.map((chunk, i) => [chunk, embeddings[i]!] as const)
              }),
            ),
          ),
          identifierIndex,
        }),
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

      const identifierIndex = yield* extractIdentifiersForChunks(phase1.chunks)
      const stats = yield* embedAndPersistChunks(
        ctx,
        phase1.chunks,
        phase1.totalChunks,
        identifierIndex,
      )
      return yield* buildIndexResult(stats, ctx.skipped, ctx.start)
    })

  return { index } as const
})

export const IndexProjectLive = Layer.effect(IndexProject, make)

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
