import { FileSystem } from "@effect/platform"
import { Effect, Layer, Option, Ref, Schema } from "effect"

import { ChunkSchema } from "../domain/chunk.js"
import type { Chunk } from "../domain/chunk.js"
import type { Embedding } from "../domain/chunk.js"
import type { EmbeddingDtype, IndexMeta } from "../domain/dtype.js"
import { DtypeMismatchError, IndexMetaSchema, VectorDecodeError } from "../domain/dtype.js"
import { ChunkValidationError, DiskFullError, NoIndexError, StoreError } from "../domain/errors.js"
import { ConfigStore, VectorStore } from "../domain/ports.js"
import type { IndexStats, SearchOptions, SearchResponse, SearchResult } from "../domain/ports.js"
import { ensureDirExists, withFsError, withReadError } from "../lib/fs-error.js"
import { makeIgnoreFilter, makeOnlyFilter } from "../lib/path-filter.js"
import { getVectorCodec } from "../lib/vector-codec.js"
import { computeCosineSimilarity, serializeVectors } from "../lib/vector-math.js"
import { ConfigStoreLive } from "./config-store.js"

const parseChunkLine = (line: string): Effect.Effect<Option.Option<Chunk>> =>
  Schema.decodeUnknown(parseJsonChunk)(line).pipe(Effect.option)

const STORE_DIR = ".pix"
const CHUNKS_FILE = `${STORE_DIR}/chunks.jsonl`
const VECTORS_FILE = `${STORE_DIR}/vectors.bin`
const META_FILE = `${STORE_DIR}/index-meta.json`

/** Pre-built Schema instance for chunk encode/decode. */
const parseJsonChunk = Schema.parseJson(ChunkSchema)

/** Build ChunkValidationError array from malformed line count, or [] if none. */
const buildChunkValidationErrors = (malformedLines: number): readonly ChunkValidationError[] =>
  malformedLines > 0
    ? [
        new ChunkValidationError({
          message: `Skipped ${malformedLines} malformed chunk line(s) in chunks.jsonl`,
          errors: [
            { path: "chunks.jsonl", message: `${malformedLines} line(s) failed schema validation` },
          ],
        }),
      ]
    : []
/**
 * FileSystem adapter for VectorStore port. Reads from chunks.jsonl and vectors.bin to provide index
 * statistics.
 */
const make = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem
  const configStore = yield* ConfigStore

  const chunksTemp = `${CHUNKS_FILE}.tmp`
  const vectorsTemp = `${VECTORS_FILE}.tmp`
  const metaTemp = `${META_FILE}.tmp`
  const seenFiles = yield* Ref.make<Set<string>>(new Set())
  const statsAccumulator = yield* Ref.make<IndexStats>({
    chunks: 0,
    files: 0,
    totalLines: 0,
    byteSize: 0,
  })
  const batchMetaRef = yield* Ref.make<{ dims: number; dtype: EmbeddingDtype }>({
    dims: 384,
    dtype: "fp32",
  })

  /**
   * Count total lines across all chunks in chunks.jsonl. Each line is a JSON object; the 'text'
   * field contains the source code.
   */
  /** Count files, total lines, and malformed lines in a single pass. */
  const countChunkStats = (
    lines: string[],
  ): Effect.Effect<{ files: Set<string>; totalLines: number; malformedLines: number }> =>
    Effect.gen(function* () {
      const files = new Set<string>()
      let totalLines = 0
      let malformedLines = 0
      for (const line of lines) {
        const chunk = yield* parseChunkLine(line)
        if (Option.isSome(chunk)) {
          files.add(chunk.value.file)
          totalLines += chunk.value.text.split("\n").length
        } else {
          malformedLines++
        }
      }
      return { files, totalLines, malformedLines }
    })

  /** Check if index files exist. Returns true if both chunks.jsonl and vectors.bin exist. */
  const checkIndexExists = (): Effect.Effect<boolean, StoreError> =>
    Effect.gen(function* () {
      const chunksExists = yield* withReadError(fs.exists(CHUNKS_FILE), "check chunks file")
      const vectorsExists = yield* withReadError(fs.exists(VECTORS_FILE), "check vectors file")
      return chunksExists && vectorsExists
    })

  /** Check that index files exist; fail with NoIndexError if either is missing. */
  const ensureIndexExists = (): Effect.Effect<void, StoreError | NoIndexError> =>
    Effect.gen(function* () {
      const exists = yield* checkIndexExists()
      if (!exists) {
        return yield* new NoIndexError({
          message: "No index found. Run pix index first.",
        })
      }
    })

  /** Read index-meta.json. Returns null only if the file is missing. */
  const readIndexMeta = (): Effect.Effect<IndexMeta | null, StoreError> =>
    Effect.gen(function* () {
      const exists = yield* withReadError(fs.exists(META_FILE), "check index meta")
      if (!exists) return null
      const content = yield* withReadError(
        fs.readFileString(META_FILE),
        "read index meta",
        META_FILE,
      )
      return yield* Schema.decodeUnknown(Schema.parseJson(IndexMetaSchema))(content).pipe(
        Effect.mapError((e) => new StoreError({ message: "Corrupted index-meta.json", cause: e })),
      )
    })

  /** Load index meta, read config, and validate dtype compatibility. */
  const loadAndValidateMeta = (): Effect.Effect<
    { dims: number; dtype: EmbeddingDtype },
    StoreError | NoIndexError | DtypeMismatchError
  > =>
    Effect.gen(function* () {
      yield* ensureIndexExists()
      const indexMeta = yield* readIndexMeta()
      if (!indexMeta) {
        return yield* new StoreError({
          message: "Index meta file missing. Index may be corrupted — run pix reset and re-index.",
        })
      }
      const config = yield* configStore
        .readConfig()
        .pipe(
          Effect.mapError(
            (cause) => new StoreError({ message: "Failed to read config for search", cause }),
          ),
        )
      const configDtype = config.embedder.dtype
      if (indexMeta.dtype !== configDtype) {
        return yield* new DtypeMismatchError({
          message: `Index was built with dtype "${indexMeta.dtype}" but config expects "${configDtype}". Re-index to fix.`,
          storedDtype: indexMeta.dtype,
          configDtype,
        })
      }
      return { dims: indexMeta.dims, dtype: configDtype }
    })

  /** Read chunks.jsonl and vectors.bin, decode vectors. */
  const loadChunksAndVectors = (
    dims: number,
    dtype: EmbeddingDtype,
  ): Effect.Effect<
    { chunkLines: string[]; vectors: Float32Array; dims: number },
    StoreError | VectorDecodeError
  > =>
    Effect.gen(function* () {
      const chunksContent = yield* withReadError(
        fs.readFileString(CHUNKS_FILE),
        "read chunks",
        CHUNKS_FILE,
      )
      const chunkLines = chunksContent.split("\n").filter((l) => l.trim().length > 0)
      const vectorsBuffer = yield* withReadError(
        fs.readFile(VECTORS_FILE),
        "read vectors",
        VECTORS_FILE,
      )
      const codec = getVectorCodec(dtype)
      const vectors = yield* codec.decode(vectorsBuffer, dims, chunkLines.length)
      return { chunkLines, vectors, dims }
    })

  /** Read and parse chunks.jsonl and vectors.bin, with dtype validation from index-meta.json. */
  const loadIndex = (): Effect.Effect<
    { chunkLines: string[]; vectors: Float32Array; dims: number },
    StoreError | NoIndexError | DtypeMismatchError | VectorDecodeError
  > =>
    Effect.gen(function* () {
      const { dims, dtype } = yield* loadAndValidateMeta()
      return yield* loadChunksAndVectors(dims, dtype)
    })

  /** Pure cosine similarity scoring loop. Returns results and malformed line count. */
  const scoreChunks = (
    chunkLines: string[],
    vectors: Float32Array,
    query: Embedding,
  ): { results: SearchResult[]; malformedLines: number } => {
    const results: SearchResult[] = []
    let malformedLines = 0
    for (let i = 0; i < chunkLines.length; i++) {
      let chunk: Chunk
      try {
        chunk = Schema.decodeUnknownSync(parseJsonChunk)(chunkLines[i])
      } catch {
        malformedLines++
        continue
      }
      const startIdx = i * query.dims
      const chunkVector = vectors.slice(startIdx, startIdx + query.dims)
      const score = computeCosineSimilarity(chunkVector, query.vector, query.dims)
      results.push({
        score,
        file: chunk.file,
        startLine: chunk.startLine,
        endLine: chunk.endLine,
        text: chunk.text,
        contextBefore: chunk.contextBefore,
        contextAfter: chunk.contextAfter,
      })
    }
    return { results, malformedLines }
  }

  /** Apply ignore/only path filters to results. */
  const applyFilters = (
    results: SearchResult[],
    ignoreFilter: ReturnType<typeof makeIgnoreFilter>,
    onlyFilter: ReturnType<typeof makeOnlyFilter>,
  ): SearchResult[] => {
    if (!ignoreFilter && !onlyFilter) return results
    return results.filter((r) => {
      if (ignoreFilter && ignoreFilter.ignores(r.file)) return false
      if (onlyFilter && !onlyFilter.ignores(r.file)) return false
      return true
    })
  }

  /** Sort by score descending, take topK, return validation errors. */
  const rankAndSlice = (
    results: SearchResult[],
    malformedLines: number,
    topK?: number,
  ): { results: SearchResult[]; validationErrors: readonly ChunkValidationError[] } => {
    const validationErrors = buildChunkValidationErrors(malformedLines)
    results.sort((a, b) => b.score - a.score)
    if (topK == null) return { results, validationErrors }
    const clamped = Math.max(0, Math.min(Math.floor(topK), results.length))
    return { results: results.slice(0, clamped), validationErrors }
  }

  /**
   * Remove a file if it exists, accumulating freed bytes. Returns the number of freed bytes (0 if
   * the file was absent).
   */
  const removeIfExists = (
    file: string,
    description: string,
  ): Effect.Effect<{ freed: number; deleted: boolean }, StoreError | DiskFullError> =>
    Effect.gen(function* () {
      const exists = yield* withFsError(fs.exists(file), `check ${description}`)
      if (!exists) return { freed: 0, deleted: false }
      const stat = yield* withFsError(fs.stat(file), `stat ${description}`, file)
      const freed = stat && "size" in stat ? Number(stat.size) : 0
      yield* withFsError(fs.remove(file), `delete ${description}`, file)
      return { freed, deleted: true }
    })

  const storeBegin = (): Effect.Effect<void, StoreError | DiskFullError> =>
    Effect.gen(function* () {
      yield* ensureDirExists(fs, STORE_DIR, ".pix directory")
      yield* Ref.set(seenFiles, new Set())
      yield* Ref.set(statsAccumulator, { chunks: 0, files: 0, totalLines: 0, byteSize: 0 })

      const chunksExists = yield* withFsError(fs.exists(chunksTemp), "check chunks temp")
      if (chunksExists) {
        yield* withFsError(fs.remove(chunksTemp), "clean stale chunks temp", chunksTemp)
      }
      const vectorsExists = yield* withFsError(fs.exists(vectorsTemp), "check vectors temp")
      if (vectorsExists) {
        yield* withFsError(fs.remove(vectorsTemp), "clean stale vectors temp", vectorsTemp)
      }
    })

  const storeBatch = (
    chunks: readonly Chunk[],
    embeddings: readonly Embedding[],
  ): Effect.Effect<void, StoreError | DiskFullError> =>
    Effect.gen(function* () {
      const lines = yield* Effect.forEach(chunks, (c) =>
        Schema.encode(parseJsonChunk)(c).pipe(
          Effect.mapError((e) => new StoreError({ message: "Failed to encode chunk", cause: e })),
        ),
      )
      const content = lines.join("\n") + "\n"
      yield* withFsError(
        fs.writeFile(chunksTemp, Buffer.from(content), { flag: "a" }),
        "append chunks",
        chunksTemp,
      )

      const buffer = yield* serializeVectors(embeddings)
      yield* withFsError(
        fs.writeFile(vectorsTemp, buffer, { flag: "a" }),
        "append vectors",
        vectorsTemp,
      )

      const dims = embeddings[0].dims
      yield* Ref.set(batchMetaRef, { dims, dtype: embeddings[0].dtype })

      const batchLines = chunks.reduce((sum, c) => sum + (c.endLine - c.startLine + 1), 0)
      const batchBytes = buffer.byteLength

      yield* Ref.update(seenFiles, (prev) => {
        for (const c of chunks) prev.add(c.file)
        return prev
      })
      yield* Ref.update(statsAccumulator, (prev) => ({
        chunks: prev.chunks + chunks.length,
        files: 0,
        totalLines: prev.totalLines + batchLines,
        byteSize: prev.byteSize + batchBytes,
      }))
    })

  const storeCommit = (): Effect.Effect<IndexStats, StoreError | DiskFullError> =>
    Effect.gen(function* () {
      yield* withFsError(fs.rename(chunksTemp, CHUNKS_FILE), "commit chunks", CHUNKS_FILE)
      yield* withFsError(fs.rename(vectorsTemp, VECTORS_FILE), "commit vectors", VECTORS_FILE)

      const config = yield* configStore
        .readConfig()
        .pipe(
          Effect.mapError(
            (cause) => new StoreError({ message: "Failed to read config for index commit", cause }),
          ),
        )
      const { dims, dtype } = yield* Ref.get(batchMetaRef)
      const indexMeta: IndexMeta = {
        schemaVersion: "1",
        dtype,
        dims,
        model: config.embedder.model,
        lastIndex: Date.now(),
      }
      yield* withFsError(
        fs.writeFile(metaTemp, Buffer.from(JSON.stringify(indexMeta))),
        "write index meta",
        metaTemp,
      )
      yield* withFsError(fs.rename(metaTemp, META_FILE), "commit index meta", META_FILE)

      const stats = yield* Ref.get(statsAccumulator)
      const files = yield* Ref.get(seenFiles)
      yield* Ref.set(seenFiles, new Set())
      return { ...stats, files: files.size }
    })

  const storeAbort = (): Effect.Effect<void, StoreError> =>
    Effect.gen(function* () {
      yield* Ref.set(seenFiles, new Set())
      const chunksExists = yield* withReadError(fs.exists(chunksTemp), "check chunks temp")
      if (chunksExists) {
        yield* withReadError(fs.remove(chunksTemp), "abort chunks temp", chunksTemp)
      }
      const vectorsExists = yield* withReadError(fs.exists(vectorsTemp), "check vectors temp")
      if (vectorsExists) {
        yield* withReadError(fs.remove(vectorsTemp), "abort vectors temp", vectorsTemp)
      }
      const metaTempExists = yield* withReadError(fs.exists(metaTemp), "check index meta temp")
      if (metaTempExists) {
        yield* withReadError(fs.remove(metaTemp), "abort index meta temp", metaTemp)
      }
    })

  const validateQueryDims = (
    queryDims: number,
    indexDims: number,
  ): Effect.Effect<void, StoreError> =>
    queryDims === indexDims
      ? Effect.void
      : Effect.fail(
          new StoreError({
            message: `Query dims (${queryDims}) do not match index dims (${indexDims}). Re-index to fix.`,
          }),
        )

  const buildFilters = (options: SearchOptions | undefined) => ({
    ignore: makeIgnoreFilter(options?.ignorePaths ?? []),
    only: makeOnlyFilter(options?.onlyPaths ?? []),
  })

  const search = (
    query: Embedding,
    options?: SearchOptions,
  ): Effect.Effect<
    SearchResponse,
    StoreError | NoIndexError | DtypeMismatchError | VectorDecodeError
  > =>
    Effect.gen(function* () {
      const { chunkLines, vectors, dims: indexDims } = yield* loadIndex()
      yield* validateQueryDims(query.dims, indexDims)
      const { ignore: ignoreFilter, only: onlyFilter } = buildFilters(options)
      const { results, malformedLines } = scoreChunks(chunkLines, vectors, query)
      const filtered = applyFilters(results, ignoreFilter, onlyFilter)
      return rankAndSlice(filtered, malformedLines, options?.topK)
    })

  const emptyStatus = {
    chunks: 0,
    files: 0,
    model: "",
    lastIndex: 0,
    totalLines: 0,
    byteSize: 0,
    validationErrors: [] as readonly ChunkValidationError[],
  }

  const buildStatusPayload = (
    lines: string[],
    uniqueFiles: Set<string>,
    totalLines: number,
    malformedLines: number,
    indexMeta: IndexMeta | null,
    vectorsStat: { size: number | bigint } | Record<string, unknown>,
  ) => ({
    chunks: lines.length - malformedLines,
    files: uniqueFiles.size,
    model: indexMeta?.model ?? "",
    lastIndex: indexMeta?.lastIndex ?? 0,
    totalLines,
    byteSize: "size" in vectorsStat ? Number(vectorsStat.size) : 0,
    validationErrors: buildChunkValidationErrors(malformedLines),
  })

  const getStatus = (): Effect.Effect<
    {
      chunks: number
      files: number
      model: string
      lastIndex: number
      totalLines: number
      byteSize: number
      validationErrors: readonly ChunkValidationError[]
    },
    StoreError
  > =>
    Effect.gen(function* () {
      const exists = yield* checkIndexExists()
      if (!exists) return emptyStatus

      const content = yield* withReadError(
        fs.readFileString(CHUNKS_FILE),
        "read chunks",
        CHUNKS_FILE,
      )
      const lines = content.split("\n").filter((l) => l.trim().length > 0)
      const { files: uniqueFiles, totalLines, malformedLines } = yield* countChunkStats(lines)
      const indexMeta = yield* readIndexMeta()
      const vectorsStat = yield* withReadError(fs.stat(VECTORS_FILE), "stat vectors", VECTORS_FILE)

      return buildStatusPayload(
        lines,
        uniqueFiles,
        totalLines,
        malformedLines,
        indexMeta,
        vectorsStat,
      )
    })

  const reset = (): Effect.Effect<
    { deletedChunks: boolean; deletedVectors: boolean; freedBytes: number },
    StoreError | DiskFullError
  > =>
    Effect.gen(function* () {
      const chunks = yield* removeIfExists(CHUNKS_FILE, "chunks")
      const vectors = yield* removeIfExists(VECTORS_FILE, "vectors")
      const meta = yield* removeIfExists(META_FILE, "index meta")

      return {
        deletedChunks: chunks.deleted,
        deletedVectors: vectors.deleted,
        freedBytes: chunks.freed + vectors.freed + meta.freed,
      }
    })

  return {
    storeBegin,
    storeBatch,
    storeCommit,
    storeAbort,
    search,
    getStatus,
    reset,
  } as const
})

export const VectorStoreLive = Layer.provideMerge(Layer.effect(VectorStore, make), ConfigStoreLive)
