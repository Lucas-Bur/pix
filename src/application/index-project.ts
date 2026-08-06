import { Context, Effect, Layer, Option, Ref, Stream } from "effect"

import type { Chunk as DomainChunk, Embedding } from "../domain/chunk.js"
import { DEFAULT_CONFIG } from "../domain/config.js"
import type { Config } from "../domain/config.js"
import type { IndexDiagnostic } from "../domain/diagnostics.js"
import type { EmbeddingDtype } from "../domain/dtype.js"
import type { AllEmbedderErrors, AllProcessorErrors, IndexError } from "../domain/errors.js"
import type { IdentifierIndexMaps } from "../domain/identifier-index.js"
import type { Identifier } from "../domain/identifier.js"
import type { FileManifestEntry, StoredChunk } from "../domain/index-data.js"
import { Display } from "../domain/ports.js"
import {
  ConfigStore,
  Scanner,
  Chunker,
  Embedder,
  SparseEmbedder,
  IndexStore,
  ContentExtractor,
  IdentifierExtractor,
  ModelRegistry,
  type IndexOptions,
  type ScannedFile,
  type IndexSnapshot,
  type CachedEmbedding,
  type ChunkingOptions,
} from "../domain/ports.js"
import { sparseContractsEqual } from "../domain/sparse.js"
import type { SparseVector } from "../domain/sparse.js"
import { getExtension } from "../lib/config/extension.js"
import { mergeConfig } from "../lib/config/validation.js"
import { contentHash } from "../lib/content-hash.js"
import { embeddingCacheKey, sparseEmbeddingCacheKey } from "../lib/embedding-cache.js"
import { buildExtensionRegistry } from "../lib/registry.js"
import { rebuildBm25Index } from "../lib/retrieval/bm25.js"
import { buildIdentifierIndex, rebuildIdentifierIndex } from "../lib/retrieval/identifier-index.js"
import { createTokenAwareChunking } from "../lib/token-count.js"
import type { StatusResult } from "./get-status.js"

interface IndexResult {
  readonly success: true
  readonly refresh: "full" | "incremental" | "none"
  readonly status: Omit<StatusResult, "model" | "lastIndex" | "diagnostics">
  readonly durationMs: number
  readonly cacheHits: number
  readonly cacheMisses: number
  readonly reusedFiles: number
  readonly processedFiles: number
  readonly diagnostics: readonly IndexDiagnostic[]
  readonly embedderFallback?: {
    readonly originalDevice: string
    readonly reason: string
  }
}

interface FileClassification {
  readonly knownFiles: ScannedFile[]
  readonly skippedFiles: string[]
  readonly unknownFiles: string[]
  readonly unknownExtensions: Set<string>
}

const classifyFiles = (
  files: readonly ScannedFile[],
  extensionRegistry: Record<string, unknown>,
  skipExtensions: ReadonlySet<string>,
): FileClassification => {
  const knownFiles: ScannedFile[] = []
  const skippedFiles: string[] = []
  const unknownFiles: string[] = []
  const unknownExtensions = new Set<string>()

  for (const file of files) {
    const ext = getExtension(file.path)
    // buildExtensionRegistry materializes skipped extensions as entries
    // (with a fail-fast processor). A presence check on the registry is
    // therefore no longer enough to distinguish "known to pix" from
    // "user explicitly skipped". Filter the skip set first.
    if (skipExtensions.has(ext)) {
      skippedFiles.push(file.path)
      continue
    }
    const entry = extensionRegistry[ext]
    if (!entry) {
      unknownExtensions.add(ext)
      unknownFiles.push(file.path)
    } else {
      knownFiles.push(file)
    }
  }

  return { knownFiles, skippedFiles, unknownFiles, unknownExtensions }
}

interface Phase1Result {
  readonly chunks: PreparedChunk[]
  readonly totalChunks: number
  readonly files: FileManifestEntry[]
  readonly reusedFiles: number
  readonly processedFiles: number
}

interface PreparedChunk {
  readonly stored: StoredChunk
  readonly text: string | null
  readonly embedding: Embedding | null
  readonly sparseVector: SparseVector | null
  readonly oldIndex: number | null
}

const storedChunk = ({ text, ...location }: DomainChunk): StoredChunk => ({
  ...location,
  contentHash: contentHash(text),
})

const sortDiagnostics = (diagnostics: readonly IndexDiagnostic[]): readonly IndexDiagnostic[] =>
  [...diagnostics].sort(
    (left, right) =>
      left.file.localeCompare(right.file) ||
      (left.startLine ?? Number.POSITIVE_INFINITY) -
        (right.startLine ?? Number.POSITIVE_INFINITY) ||
      left.kind.localeCompare(right.kind) ||
      left.message.localeCompare(right.message),
  )

/** Result of classifying and optionally processing one scanned source file. */
interface PreparedFileResult {
  readonly chunks: readonly PreparedChunk[]
  readonly manifest: FileManifestEntry | null
  readonly reused: boolean
}

const batchPreparedChunks = (
  chunks: readonly PreparedChunk[],
  maxBatchSize: number,
): readonly (readonly PreparedChunk[])[] => {
  const batches: PreparedChunk[][] = []
  let current: PreparedChunk[] = []

  const flush = () => {
    if (current.length === 0) return
    batches.push(current)
    current = []
  }

  for (const chunk of chunks) {
    if (current.length >= maxBatchSize) flush()
    current.push(chunk)
  }
  flush()
  return batches
}

/** Dependencies and prior state needed to prepare one scanned file. */
interface PrepareFileInput {
  readonly file: ScannedFile
  readonly previous: FileManifestEntry | undefined
  readonly previousEntries: IndexSnapshot["entries"]
  readonly contractMatches: boolean
  readonly retainedDtype: EmbeddingDtype
  readonly extractor: typeof ContentExtractor.Service
  readonly chunker: typeof Chunker.Service
  readonly diagnostics: Ref.Ref<readonly IndexDiagnostic[]>
  readonly chunkingOptions: ChunkingOptions
}

const retainedFile = (
  file: ScannedFile,
  previous: FileManifestEntry,
  entries: IndexSnapshot["entries"],
  dtype: EmbeddingDtype,
): PreparedFileResult => ({
  manifest: { ...previous, mtimeMs: file.mtimeMs, size: file.size },
  reused: true,
  chunks: entries.map(({ index, vector, sparseVector, ...stored }) => ({
    stored,
    text: null,
    embedding: { vector, dims: vector.length, dtype },
    sparseVector: sparseVector,
    oldIndex: index,
  })),
})

const prepareFile = ({
  file,
  previous,
  previousEntries,
  contractMatches,
  retainedDtype,
  extractor,
  chunker,
  diagnostics,
  chunkingOptions,
}: PrepareFileInput): Effect.Effect<PreparedFileResult, AllProcessorErrors | AllEmbedderErrors> =>
  Effect.gen(function* () {
    if (
      previous &&
      contractMatches &&
      previous.mtimeMs === file.mtimeMs &&
      previous.size === file.size
    ) {
      return retainedFile(file, previous, previousEntries, retainedDtype)
    }
    const result = yield* extractor.extract(file.path).pipe(
      Effect.map((text) => Option.some(text)),
      Effect.catch((error) =>
        Ref.update(diagnostics, (entries) => [
          ...entries.filter((entry) => entry.file !== file.path),
          {
            kind: "skipped-file",
            file: file.path,
            message: error.message,
          } satisfies IndexDiagnostic,
        ]).pipe(Effect.as(Option.none<string>())),
      ),
    )
    if (Option.isNone(result)) return { chunks: [], manifest: null, reused: false }
    const fileHash = contentHash(result.value)
    if (previous && contractMatches && previous.contentHash === fileHash) {
      return retainedFile(file, previous, previousEntries, retainedDtype)
    }
    yield* Ref.update(diagnostics, (entries) => entries.filter((entry) => entry.file !== file.path))
    const chunks = yield* chunker.chunkText(result.value, file.path, chunkingOptions)
    return {
      manifest: { file: file.path, mtimeMs: file.mtimeMs, size: file.size, contentHash: fileHash },
      reused: false,
      chunks: chunks.map((chunk) => ({
        stored: storedChunk(chunk),
        text: chunk.text,
        embedding: null,
        sparseVector: null,
        oldIndex: null,
      })),
    }
  })

const classifyAndCollectChunks = (
  knownFiles: ScannedFile[],
  extractor: typeof ContentExtractor.Service,
  chunker: typeof Chunker.Service,
  diagnostics: Ref.Ref<readonly IndexDiagnostic[]>,
  chunkingOptions: ChunkingOptions,
  snapshot: Option.Option<IndexSnapshot>,
  contractMatches: boolean,
  retainedDtype: EmbeddingDtype,
  concurrency: number,
): Effect.Effect<Phase1Result, AllProcessorErrors | AllEmbedderErrors> =>
  Effect.gen(function* () {
    const allChunks: PreparedChunk[] = []
    const files: FileManifestEntry[] = []
    let reusedFiles = 0
    let processedFiles = 0
    const previousFiles = new Map(
      Option.match(snapshot, { onNone: () => [], onSome: (value) => value.files }).map((file) => [
        file.file,
        file,
      ]),
    )
    const previousEntries = new Map<string, IndexSnapshot["entries"]>()
    if (Option.isSome(snapshot)) {
      for (const entry of snapshot.value.entries) {
        previousEntries.set(entry.file, [...(previousEntries.get(entry.file) ?? []), entry])
      }
    }

    const sortedFiles = [...knownFiles].sort((left, right) => left.path.localeCompare(right.path))
    const preparedFiles = yield* Effect.forEach(
      sortedFiles,
      (file) =>
        prepareFile({
          file,
          previous: previousFiles.get(file.path),
          previousEntries: previousEntries.get(file.path) ?? [],
          contractMatches,
          retainedDtype,
          extractor,
          chunker,
          diagnostics,
          chunkingOptions,
        }),
      { concurrency },
    )
    for (const prepared of preparedFiles) {
      if (prepared.manifest) files.push(prepared.manifest)
      allChunks.push(...prepared.chunks)
      if (prepared.reused) reusedFiles++
      else if (prepared.manifest) processedFiles++
    }
    return {
      chunks: allChunks,
      totalChunks: allChunks.length,
      files,
      reusedFiles,
      processedFiles,
    }
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
  const sparseEmbedder = yield* SparseEmbedder
  const indexStore = yield* IndexStore
  const d = yield* Display
  const extractor = yield* ContentExtractor
  const identifierExtractor = yield* IdentifierExtractor
  const modelRegistry = yield* ModelRegistry

  interface IndexContext {
    readonly eff: ReturnType<typeof mergeConfig>
    readonly config: Config
    readonly knownFiles: ScannedFile[]
    readonly diagnostics: Ref.Ref<readonly IndexDiagnostic[]>
    readonly chunkingOptions: ChunkingOptions
    readonly snapshot: Option.Option<IndexSnapshot>
    readonly contractMatches: boolean
    readonly sparseContractMatches: boolean
    readonly dims: number
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
      const modelInfo = yield* modelRegistry.get(config.embedder.model)
      const dims = Option.match(modelInfo, { onNone: () => 0, onSome: (info) => info.dims })
      const { maxTokens, countTokens } = createTokenAwareChunking(
        eff.chunkTokens,
        embedder,
        sparseEmbedder,
      )
      const snapshot = yield* indexStore.loadIndexSnapshot()
      const sparseContractMatches = Option.match(snapshot, {
        onNone: () => false,
        onSome: ({ sparseContract }) =>
          sparseContractsEqual(sparseContract, sparseEmbedder.contract),
      })
      const contractMatches = Option.match(snapshot, {
        onNone: () => false,
        onSome: ({ meta, sparseContract }) =>
          meta.model === config.embedder.model &&
          meta.dtype === config.embedder.dtype &&
          meta.dims === dims &&
          meta.chunkTokens === maxTokens &&
          sparseContractsEqual(sparseContract, sparseEmbedder.contract),
      })
      const extensionRegistry = buildExtensionRegistry(eff.skipExtensions)

      yield* d.updateInteractive("Scanning source files...")
      const scanResult = yield* scanner.scanFiles(eff.ignoredPaths, eff.ignoreGitignore)

      const { knownFiles, unknownFiles, unknownExtensions } = classifyFiles(
        scanResult.files,
        extensionRegistry,
        new Set(eff.skipExtensions),
      )

      const knownPaths = new Set(knownFiles.map((file) => file.path))
      const previousDiagnostics = Option.match(snapshot, {
        onNone: () => [],
        onSome: (value) => value.meta.diagnostics.filter((entry) => knownPaths.has(entry.file)),
      })
      const diagnostics = yield* Ref.make<readonly IndexDiagnostic[]>([
        ...previousDiagnostics,
        ...scanResult.skipped
          .filter((s) => !s.reason.startsWith("Ignored by config pattern"))
          .map((s) => ({ kind: "skipped-file" as const, file: s.path, message: s.reason })),
      ])

      if (unknownExtensions.size > 0) {
        yield* Ref.update(diagnostics, (prev) => [
          ...prev,
          ...unknownFiles.map((f) => ({
            kind: "skipped-file" as const,
            file: f,
            message: "unknown extension",
          })),
        ])
      }

      const chunkingOptions: ChunkingOptions = {
        maxTokens,
        overlapLines: config.overlapLines,
        countTokens,
        onDiagnostic: (diagnostic) => Ref.update(diagnostics, (prev) => [...prev, diagnostic]),
      }

      return {
        eff,
        config,
        knownFiles,
        diagnostics,
        chunkingOptions,
        snapshot,
        contractMatches,
        sparseContractMatches,
        dims,
        start: Date.now(),
      }
    })

  const scanAndChunkFiles = (ctx: IndexContext): Effect.Effect<Phase1Result, IndexError> =>
    Effect.gen(function* () {
      if (ctx.knownFiles.length === 0) {
        return {
          chunks: [],
          totalChunks: 0,
          files: [],
          reusedFiles: 0,
          processedFiles: 0,
        }
      }

      yield* d.updateInteractive(`Checking ${ctx.knownFiles.length} files for changes...`)
      return yield* classifyAndCollectChunks(
        ctx.knownFiles,
        extractor,
        chunker,
        ctx.diagnostics,
        ctx.chunkingOptions,
        ctx.snapshot,
        ctx.contractMatches,
        ctx.config.embedder.dtype,
        ctx.eff.concurrency,
      )
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
    chunks: readonly PreparedChunk[],
    snapshot: Option.Option<IndexSnapshot>,
  ): Effect.Effect<IdentifierIndexMaps, never> =>
    Effect.gen(function* () {
      const all: Identifier[] = []
      const retainedIndexes = new Map<number, number>()
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i]
        if (chunk.oldIndex !== null) {
          retainedIndexes.set(chunk.oldIndex, i)
          continue
        }
        if (chunk.text === null) continue
        const ids = yield* identifierExtractor.extractIdentifiers(chunk.stored.file, chunk.text, i)
        for (const id of ids) all.push(id)
      }
      return rebuildIdentifierIndex(
        Option.match(snapshot, { onNone: () => null, onSome: (value) => value.identifierIndex }),
        retainedIndexes,
        buildIdentifierIndex(all),
      )
    })

  const embedAndPersistChunks = (
    ctx: IndexContext,
    chunks: PreparedChunk[],
    totalChunks: number,
    identifierIndex: IdentifierIndexMaps,
    files: readonly FileManifestEntry[],
    reusedFiles: number,
    processedFiles: number,
  ): Effect.Effect<
    {
      chunks: number
      files: number
      totalLines: number
      byteSize: number
      cacheHits: number
      cacheMisses: number
      reusedFiles: number
      processedFiles: number
    },
    IndexError
  > =>
    Effect.gen(function* () {
      const embeddedRef = yield* Ref.make(0)
      const cacheHits = yield* Ref.make(0)
      const cacheMisses = yield* Ref.make(0)
      const cached = yield* indexStore.loadEmbeddingCache()
      const cachedSparse = yield* indexStore.loadSparseEmbeddingCache()
      const dims = ctx.dims
      const available = new Map<string, CachedEmbedding>()
      const availableSparse = new Map<string, SparseVector>()
      const historicalSparseCache = new Map(
        cachedSparse.map((entry) => [
          sparseEmbeddingCacheKey(entry.contentHash, entry.contract),
          entry,
        ]),
      )
      for (const entry of cached) {
        available.set(
          embeddingCacheKey(
            entry.contentHash,
            entry.model,
            entry.embedding.dims,
            entry.embedding.dtype,
          ),
          entry,
        )
      }
      for (const entry of cachedSparse) {
        if (sparseContractsEqual(entry.contract, sparseEmbedder.contract)) {
          availableSparse.set(
            sparseEmbeddingCacheKey(entry.contentHash, entry.contract),
            entry.vector,
          )
        }
      }
      if (Option.isSome(ctx.snapshot)) {
        for (const entry of ctx.snapshot.value.entries) {
          const cachedEntry: CachedEmbedding = {
            contentHash: entry.contentHash,
            model: ctx.snapshot.value.meta.model,
            embedding: {
              vector: entry.vector,
              dims: ctx.snapshot.value.meta.dims,
              dtype: ctx.snapshot.value.meta.dtype,
            },
          }
          available.set(
            embeddingCacheKey(
              cachedEntry.contentHash,
              cachedEntry.model,
              cachedEntry.embedding.dims,
              cachedEntry.embedding.dtype,
            ),
            cachedEntry,
          )
          if (ctx.sparseContractMatches) {
            const cacheKey = sparseEmbeddingCacheKey(entry.contentHash, sparseEmbedder.contract)
            availableSparse.set(cacheKey, entry.sparseVector)
            historicalSparseCache.set(cacheKey, {
              contentHash: entry.contentHash,
              contract: sparseEmbedder.contract,
              vector: entry.sparseVector,
            })
          }
        }
      }
      const historicalCache = new Map(available)
      for (const chunk of chunks) {
        historicalCache.delete(
          embeddingCacheKey(
            chunk.stored.contentHash,
            ctx.config.embedder.model,
            dims,
            ctx.config.embedder.dtype,
          ),
        )
        historicalSparseCache.delete(
          sparseEmbeddingCacheKey(chunk.stored.contentHash, sparseEmbedder.contract),
        )
      }
      const retainedIndexes = new Map<number, number>()
      const newTexts: { index: number; text: string }[] = []
      for (let index = 0; index < chunks.length; index++) {
        const chunk = chunks[index]!
        if (chunk.oldIndex !== null) retainedIndexes.set(chunk.oldIndex, index)
        else if (chunk.text !== null) newTexts.push({ index, text: chunk.text })
      }
      const bm25Index = rebuildBm25Index(
        Option.match(ctx.snapshot, { onNone: () => null, onSome: (value) => value.bm25Index }),
        retainedIndexes,
        newTexts,
        chunks.length,
      )
      const sparseIdf =
        ctx.sparseContractMatches && Option.isSome(ctx.snapshot)
          ? ctx.snapshot.value.sparseIdf
          : yield* sparseEmbedder.loadIdf()

      const stats = yield* d.progress(
        { message: `Writing index with ${totalChunks} chunks...`, max: totalChunks },
        indexStore.persistIndex({
          chunks: Stream.fromIterable(
            batchPreparedChunks(chunks, Math.min(ctx.eff.batchSize, ctx.config.embedder.batchSize)),
          ).pipe(
            Stream.mapEffect((batch: readonly PreparedChunk[]) =>
              Effect.gen(function* () {
                const keys = batch.map((chunk) =>
                  embeddingCacheKey(
                    chunk.stored.contentHash,
                    ctx.config.embedder.model,
                    dims,
                    ctx.config.embedder.dtype,
                  ),
                )
                const missingByKey = new Map<string, PreparedChunk>()
                for (let index = 0; index < keys.length; index++) {
                  const key = keys[index]!
                  const chunk = batch[index]!
                  if (!chunk.embedding && !available.has(key) && !missingByKey.has(key)) {
                    missingByKey.set(key, chunk)
                  }
                }
                const existingCacheHits = keys.filter(
                  (key, index) => !batch[index]!.embedding && available.has(key),
                ).length
                const duplicateCacheHits =
                  keys.filter((_, index) => !batch[index]!.embedding).length -
                  existingCacheHits -
                  missingByKey.size
                const missing = [...missingByKey.entries()]
                const missingSparseByKey = new Map<string, PreparedChunk>()
                for (const chunk of batch) {
                  const sparseKey = sparseEmbeddingCacheKey(
                    chunk.stored.contentHash,
                    sparseEmbedder.contract,
                  )
                  if (
                    !chunk.sparseVector &&
                    !availableSparse.has(sparseKey) &&
                    !missingSparseByKey.has(sparseKey)
                  ) {
                    missingSparseByKey.set(sparseKey, chunk)
                  }
                }
                const missingSparse = [...missingSparseByKey.entries()]
                const embedded =
                  missing.length > 0
                    ? yield* embedder.batch(missing.map(([, chunk]) => chunk.text ?? ""))
                    : []
                const sparseVectors: SparseVector[] = []
                for (
                  let start = 0;
                  start < missingSparse.length;
                  start += ctx.config.sparseEmbedder.batchSize
                ) {
                  const group = missingSparse.slice(
                    start,
                    start + ctx.config.sparseEmbedder.batchSize,
                  )
                  sparseVectors.push(
                    ...(yield* sparseEmbedder.batch(group.map(([, chunk]) => chunk.text ?? ""))),
                  )
                }
                for (let index = 0; index < missing.length; index++) {
                  const [key, chunk] = missing[index]!
                  available.set(key, {
                    contentHash: chunk.stored.contentHash,
                    model: ctx.config.embedder.model,
                    embedding: embedded[index]!,
                  })
                }
                for (let index = 0; index < missingSparse.length; index++) {
                  availableSparse.set(missingSparse[index]![0], sparseVectors[index]!)
                }
                const embeddings = keys.map((key, index) => {
                  const retained = batch[index]!.embedding
                  if (retained) return retained
                  return available.get(key)!.embedding
                })
                const sparseEmbeddings = batch.map(
                  (chunk) =>
                    chunk.sparseVector ??
                    availableSparse.get(
                      sparseEmbeddingCacheKey(chunk.stored.contentHash, sparseEmbedder.contract),
                    )!,
                )
                yield* Ref.update(
                  cacheHits,
                  (hits) => hits + existingCacheHits + duplicateCacheHits,
                )
                yield* Ref.update(cacheMisses, (misses) => misses + missing.length)
                const count = yield* Ref.updateAndGet(embeddedRef, (n) => n + batch.length)
                yield* d.updateInteractive({
                  message: `Writing ${count} of ${totalChunks} chunks`,
                  setTo: count,
                })
                return batch.map(
                  (chunk, i) => [chunk.stored, embeddings[i]!, sparseEmbeddings[i]!] as const,
                )
              }),
            ),
          ),
          identifierIndex,
          bm25Index,
          files,
          dims: ctx.dims,
          dtype: ctx.config.embedder.dtype,
          chunkTokens: ctx.chunkingOptions.maxTokens,
          embeddingCache: [...historicalCache.values()],
          sparseEmbeddingCache: [...historicalSparseCache.values()],
          sparseContract: sparseEmbedder.contract,
          sparseIdf,
          diagnostics: sortDiagnostics(yield* Ref.get(ctx.diagnostics)),
        }),
      )
      return {
        ...stats,
        cacheHits: yield* Ref.get(cacheHits),
        cacheMisses: yield* Ref.get(cacheMisses),
        reusedFiles,
        processedFiles,
      }
    })

  const buildIndexResult = (
    stats: {
      chunks: number
      files: number
      totalLines: number
      byteSize: number
      cacheHits: number
      cacheMisses: number
      reusedFiles: number
      processedFiles: number
      refresh: "full" | "incremental"
    },
    diagnostics: Ref.Ref<readonly IndexDiagnostic[]>,
    start: number,
  ): Effect.Effect<IndexResult> =>
    Effect.gen(function* () {
      const collected = sortDiagnostics(yield* Ref.get(diagnostics))
      yield* displayDiagnostics(d, collected)

      const durationSec = ((Date.now() - start) / 1000).toFixed(1)
      const activity =
        stats.refresh === "full"
          ? `Indexed ${stats.chunks} chunks from ${stats.files} files`
          : `Refreshed ${stats.processedFiles} file(s), reused ${stats.reusedFiles}`
      yield* d.log(`${activity} in ${durationSec}s`, "success")
      yield* d.log(
        `Embeddings: ${stats.cacheMisses} computed, ${stats.cacheHits} cache hit(s)`,
        "info",
      )

      const fallbackInfo = yield* embedder.getFallbackInfo()

      return {
        success: true as const,
        refresh: stats.refresh,
        status: {
          chunks: stats.chunks,
          files: stats.files,
          totalLines: stats.totalLines,
          byteSize: stats.byteSize,
          validationErrors: [],
        },
        durationMs: Date.now() - start,
        cacheHits: stats.cacheHits,
        cacheMisses: stats.cacheMisses,
        reusedFiles: stats.reusedFiles,
        processedFiles: stats.processedFiles,
        diagnostics: collected,
        embedderFallback: fallbackInfo,
      }
    })

  const snapshotIsCurrent = (ctx: IndexContext, phase: Phase1Result): boolean =>
    Option.match(ctx.snapshot, {
      onNone: () => false,
      onSome: (snapshot) => {
        if (
          !ctx.contractMatches ||
          phase.processedFiles > 0 ||
          snapshot.files.length !== phase.files.length
        )
          return false
        const previous = new Map(snapshot.files.map((file) => [file.file, file]))
        return phase.files.every((file) => {
          const old = previous.get(file.file)
          return (
            old?.mtimeMs === file.mtimeMs &&
            old.size === file.size &&
            old.contentHash === file.contentHash
          )
        })
      },
    })

  const freshIndexResult = (
    ctx: IndexContext,
    phase: Phase1Result,
  ): Effect.Effect<IndexResult, IndexError> =>
    Effect.gen(function* () {
      const status = yield* indexStore.getStatus()
      yield* d.log(
        `Index already fresh (${status.files} files, ${status.chunks} chunks)`,
        "success",
      )
      return {
        success: true as const,
        refresh: "none",
        status: {
          chunks: status.chunks,
          files: status.files,
          totalLines: status.totalLines,
          byteSize: status.byteSize,
          validationErrors: status.validationErrors,
        },
        durationMs: Date.now() - ctx.start,
        cacheHits: 0,
        cacheMisses: 0,
        reusedFiles: phase.reusedFiles,
        processedFiles: 0,
        diagnostics: Option.match(ctx.snapshot, {
          onNone: () => [],
          onSome: (snapshot) => snapshot.meta.diagnostics,
        }),
      }
    })

  const index = (opts: IndexOptions = {}): Effect.Effect<IndexResult, IndexError> =>
    Effect.gen(function* () {
      const { ctx, phase1 } = yield* d.spinner(
        "Checking source files...",
        Effect.gen(function* () {
          const ctx = yield* prepareIndexContext(opts)
          const phase1 = yield* scanAndChunkFiles(ctx)
          return { ctx, phase1 }
        }),
      )
      if (snapshotIsCurrent(ctx, phase1)) return yield* freshIndexResult(ctx, phase1)
      const identifierIndex = yield* extractIdentifiersForChunks(phase1.chunks, ctx.snapshot)
      const stats = yield* embedAndPersistChunks(
        ctx,
        phase1.chunks,
        phase1.totalChunks,
        identifierIndex,
        phase1.files,
        phase1.reusedFiles,
        phase1.processedFiles,
      )
      return yield* buildIndexResult(
        {
          ...stats,
          refresh: !ctx.contractMatches || Option.isNone(ctx.snapshot) ? "full" : "incremental",
        },
        ctx.diagnostics,
        ctx.start,
      )
    })

  return { index } as const
})

export const IndexProjectLive = Layer.effect(IndexProject, make)

const displayDiagnostics = (
  d: typeof Display.Service,
  diagnostics: readonly IndexDiagnostic[],
): Effect.Effect<void> => {
  if (diagnostics.length === 0) return Effect.void
  return d.note(
    diagnostics
      .slice(0, 20)
      .map((diagnostic) => `${diagnostic.kind}: ${diagnostic.file}: ${diagnostic.message}`)
      .join("\n"),
    `Index diagnostics (${diagnostics.length})`,
  )
}
