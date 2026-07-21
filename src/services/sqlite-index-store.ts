import { Effect, Layer, Option, Ref, Schema, Stream } from "effect"
import { FileSystem } from "effect/FileSystem"
import { SqlClient } from "effect/unstable/sql"
import * as SqlSchema from "effect/unstable/sql/SqlSchema"

import type { Embedding } from "../domain/chunk.ts"
import type { EmbeddingDtype, IndexMeta } from "../domain/dtype.js"
import { DtypeMismatchError, VectorDecodeError } from "../domain/dtype.js"
import { ChunkValidationError, NoIndexError, StoreError } from "../domain/errors.js"
import type { FileManifestEntry } from "../domain/index-data.js"
import { ConfigStore, IndexStore } from "../domain/ports.js"
import type {
  CachedEmbedding,
  ChunkEntry,
  ChunkMetadata,
  IndexSnapshot,
  IndexStats,
  PersistIndexInput,
  RankedChunk,
  SearchData,
  SourceContent,
  SourceRequest,
} from "../domain/ports.js"
import { contentHash } from "../lib/content-hash.js"
import { ConfigStoreLive } from "./config-store.js"
import { SqliteIndexDatabaseLive } from "./sqlite-index-store/client.js"
import {
  ChunkMetadataRow,
  ChunkRow,
  DenseMatchRow,
  DenseSearchRequest,
  EmbeddingCacheRow,
  FileManifestRow,
  IndexMetaRow,
  RetrievalIndexesRow,
} from "./sqlite-index-store/schema.js"

const emptyStatus: {
  chunks: number
  files: number
  model: string
  lastIndex: number
  totalLines: number
  byteSize: number
  validationErrors: readonly ChunkValidationError[]
} = {
  chunks: 0,
  files: 0,
  model: "",
  lastIndex: 0,
  totalLines: 0,
  byteSize: 0,
  validationErrors: [],
}

const StatusRow = Schema.Struct({
  chunks: Schema.Number,
  files: Schema.Number,
  totalLines: Schema.Number,
  byteSize: Schema.Number,
})

const CacheCountRow = Schema.Struct({ count: Schema.Number })

const LEGACY_INDEX_FILES = [
  ".pix/chunks.jsonl",
  ".pix/vectors.bin",
  ".pix/index-meta.json",
  ".pix/bm25.json",
  ".pix/identifiers.json",
  ".pix/files.jsonl",
  ".pix/embedding-cache.jsonl",
] as const

const asStoreError = (message: string) => (cause: unknown) => new StoreError({ message, cause })

const copyVector = (vector: Float32Array): Float32Array<ArrayBuffer> => new Float32Array(vector)

const validateVector = (
  vector: Float32Array,
  dims: number,
  dtype: EmbeddingDtype,
  expectedDims: number,
  expectedDtype: EmbeddingDtype,
): Effect.Effect<void, StoreError> =>
  vector.length === dims && dims === expectedDims && dtype === expectedDtype
    ? Effect.void
    : Effect.fail(
        new StoreError({
          message: `Invalid embedding contract: expected ${expectedDims}/${expectedDtype}, got ${vector.length}/${dims}/${dtype}`,
        }),
      )

const make = Effect.gen(function* () {
  const fs = yield* FileSystem
  const configStore = yield* ConfigStore
  const sql = yield* SqlClient.SqlClient
  const quantized = yield* Ref.make(false)

  const insertMeta = SqlSchema.void({
    Request: IndexMetaRow.insert,
    execute: ({ id, model, dims, dtype, lastIndex }) => sql`
      INSERT INTO index_meta (id, model, dims, dtype, last_index)
      VALUES (${id}, ${model}, ${dims}, ${dtype}, ${lastIndex})
    `,
  })

  const insertChunk = SqlSchema.void({
    Request: ChunkRow.insert,
    execute: (row) => sql`
      INSERT INTO chunks (
        ordinal, id, idx, file, start_line, end_line, start_offset, end_offset, content_hash,
        embedding
      ) VALUES (
        ${row.ordinal}, ${row.id}, ${row.idx}, ${row.file}, ${row.startLine}, ${row.endLine},
        ${row.startOffset}, ${row.endOffset}, ${row.contentHash},
        vector_as_f32(${row.embedding}, ${row.embedding.byteLength / Float32Array.BYTES_PER_ELEMENT})
      )
    `,
  })

  const insertFile = SqlSchema.void({
    Request: FileManifestRow.insert,
    execute: ({ file, mtimeMs, size, contentHash }) => sql`
      INSERT INTO files (file, mtime_ms, size, content_hash)
      VALUES (${file}, ${mtimeMs}, ${size}, ${contentHash})
    `,
  })

  const insertRetrievalIndexes = SqlSchema.void({
    Request: RetrievalIndexesRow.insert,
    execute: ({ id, bm25Index, identifierIndex }) => sql`
      INSERT INTO retrieval_indexes (id, bm25_json, identifier_json)
      VALUES (${id}, ${bm25Index}, ${identifierIndex})
    `,
  })

  const insertCache = SqlSchema.void({
    Request: EmbeddingCacheRow.insert,
    execute: ({ contentHash, model, dims, dtype, embedding }) => sql`
      INSERT INTO embedding_cache (content_hash, model, dims, dtype, embedding)
      VALUES (
        ${contentHash}, ${model}, ${dims}, ${dtype},
        vector_as_f32(${embedding}, ${dims})
      )
    `,
  })

  const selectMeta = SqlSchema.findOneOption({
    Request: Schema.Void,
    Result: IndexMetaRow,
    execute: () => sql`SELECT id, model, dims, dtype, last_index FROM index_meta WHERE id = 1`,
  })

  const selectChunks = SqlSchema.findAll({
    Request: Schema.Void,
    Result: ChunkRow,
    execute: () => sql`
      SELECT ordinal, id, idx, file, start_line, end_line, start_offset, end_offset,
             content_hash, embedding
      FROM chunks
      ORDER BY ordinal
    `,
  })

  const selectChunkMetadata = SqlSchema.findAll({
    Request: Schema.Void,
    Result: ChunkMetadataRow,
    execute: () => sql`
      SELECT ordinal, id, idx, file, start_line, end_line, start_offset, end_offset, content_hash
      FROM chunks
      ORDER BY ordinal
    `,
  })

  const exactDenseSearch = SqlSchema.findAll({
    Request: DenseSearchRequest,
    Result: DenseMatchRow,
    execute: ({ embedding }) => sql`
      SELECT chunks.ordinal, scan.distance
      FROM vector_full_scan('chunks', 'embedding', ${embedding}) AS scan
      JOIN chunks ON chunks.rowid = scan.rowid
      WHERE scan.distance < 1.0
      ORDER BY scan.distance ASC, chunks.ordinal ASC
    `,
  })

  const quantizedDenseSearch = SqlSchema.findAll({
    Request: DenseSearchRequest,
    Result: DenseMatchRow,
    execute: ({ embedding }) => sql`
      SELECT chunks.ordinal, scan.distance
      FROM vector_quantize_scan('chunks', 'embedding', ${embedding}) AS scan
      JOIN chunks ON chunks.rowid = scan.rowid
      WHERE scan.distance < 1.0
      ORDER BY scan.distance ASC, chunks.ordinal ASC
    `,
  })

  const selectFiles = SqlSchema.findAll({
    Request: Schema.Void,
    Result: FileManifestRow,
    execute: () => sql`SELECT file, mtime_ms, size, content_hash FROM files ORDER BY file`,
  })

  const selectRetrievalIndexes = SqlSchema.findOneOption({
    Request: Schema.Void,
    Result: RetrievalIndexesRow,
    execute: () => sql`
      SELECT id, bm25_json AS bm25_index, identifier_json AS identifier_index
      FROM retrieval_indexes
      WHERE id = 1
    `,
  })

  const selectCache = SqlSchema.findAll({
    Request: Schema.Void,
    Result: EmbeddingCacheRow,
    execute: () => sql`
      SELECT content_hash, model, dims, dtype, embedding
      FROM embedding_cache
      ORDER BY content_hash, model, dims, dtype
    `,
  })

  const selectStatus = SqlSchema.findOne({
    Request: Schema.Void,
    Result: StatusRow,
    execute: () => sql`
      SELECT
        COUNT(*) AS chunks,
        COUNT(DISTINCT file) AS files,
        COALESCE(SUM(end_line - start_line + 1), 0) AS total_lines,
        COALESCE(SUM(length(embedding)), 0) AS byte_size
      FROM chunks
    `,
  })

  const selectCacheCount = SqlSchema.findOne({
    Request: Schema.Void,
    Result: CacheCountRow,
    execute: () => sql`SELECT COUNT(*) AS count FROM embedding_cache`,
  })

  const readMeta = () =>
    selectMeta(undefined).pipe(Effect.mapError(asStoreError("read index metadata")))

  const requireMeta = (): Effect.Effect<IndexMetaRow, StoreError | NoIndexError> =>
    Effect.gen(function* () {
      const meta = yield* readMeta()
      if (Option.isNone(meta)) {
        return yield* new NoIndexError({ message: "No index found. Run pix index first." })
      }
      return meta.value
    })

  const readChunks = (): Effect.Effect<readonly ChunkRow[], StoreError> =>
    selectChunks(undefined).pipe(Effect.mapError(asStoreError("read chunks")))

  const readChunkMetadata = (): Effect.Effect<readonly ChunkMetadataRow[], StoreError> =>
    selectChunkMetadata(undefined).pipe(Effect.mapError(asStoreError("read chunk metadata")))

  const readRetrievalIndexes = (): Effect.Effect<RetrievalIndexesRow, StoreError> =>
    Effect.gen(function* () {
      const indexes = yield* selectRetrievalIndexes(undefined).pipe(
        Effect.mapError(asStoreError("read retrieval indexes")),
      )
      if (Option.isNone(indexes)) {
        return yield* new StoreError({ message: "Index retrieval data is missing" })
      }
      return indexes.value
    })

  const toEntries = (
    rows: readonly ChunkRow[],
    dims: number,
  ): Effect.Effect<readonly ChunkEntry[], VectorDecodeError> =>
    Effect.forEach(rows, (row) =>
      row.embedding.length === dims
        ? Effect.succeed({
            index: row.ordinal,
            id: row.id,
            idx: row.idx,
            file: row.file,
            startLine: row.startLine,
            endLine: row.endLine,
            startOffset: row.startOffset,
            endOffset: row.endOffset,
            contentHash: row.contentHash,
            vector: row.embedding,
          })
        : Effect.fail(
            new VectorDecodeError({
              message: `Invalid vector dimensions for chunk ${row.id}: expected ${dims}, got ${row.embedding.length}`,
              dtype: "fp32",
            }),
          ),
    )

  const toMetadata = (rows: readonly ChunkMetadataRow[]): readonly ChunkMetadata[] =>
    rows.map((row) => ({
      index: row.ordinal,
      id: row.id,
      idx: row.idx,
      file: row.file,
      startLine: row.startLine,
      endLine: row.endLine,
      startOffset: row.startOffset,
      endOffset: row.endOffset,
      contentHash: row.contentHash,
    }))

  const initializeVectors = (dims: number) =>
    sql`SELECT vector_init(
      'chunks',
      'embedding',
      ${`dimension=${dims},type=FLOAT32,distance=COSINE`}
    )`

  const buildQuantization = (dims: number) =>
    Effect.gen(function* () {
      yield* initializeVectors(dims)
      yield* sql`SELECT vector_quantize('chunks', 'embedding', 'qtype=TURBO,qbits=4')`
      yield* Ref.set(quantized, true)
    })

  const removeLegacyIndexFiles = () =>
    Effect.forEach(LEGACY_INDEX_FILES, (path) =>
      Effect.gen(function* () {
        if (yield* fs.exists(path)) yield* fs.remove(path)
      }),
    )

  const persistIndex = <E>(
    input: PersistIndexInput<E>,
  ): Effect.Effect<IndexStats, StoreError | E> =>
    Effect.gen(function* () {
      const config = yield* configStore
        .readConfig()
        .pipe(Effect.mapError(asStoreError("read config for index commit")))
      let ordinal = 0
      let totalLines = 0
      let byteSize = 0
      const seenFiles = new Set<string>()

      const transaction = Effect.gen(function* () {
        yield* sql`DELETE FROM index_meta`
        yield* sql`DELETE FROM retrieval_indexes`
        yield* sql`DELETE FROM files`
        yield* sql`DELETE FROM chunks`
        yield* sql`DELETE FROM embedding_cache`

        yield* Stream.runForEach(input.chunks, (batch) =>
          Effect.forEach(batch, ([chunk, embedding]) =>
            Effect.gen(function* () {
              yield* validateVector(
                embedding.vector,
                embedding.dims,
                embedding.dtype,
                input.dims,
                input.dtype,
              )
              yield* insertChunk({ ordinal, ...chunk, embedding: copyVector(embedding.vector) })
              ordinal++
              totalLines += chunk.endLine - chunk.startLine + 1
              byteSize += embedding.vector.byteLength
              seenFiles.add(chunk.file)
            }),
          ),
        )

        yield* Effect.forEach(input.files, insertFile)
        yield* insertRetrievalIndexes({
          id: 1,
          bm25Index: input.bm25Index,
          identifierIndex: input.identifierIndex,
        })
        yield* Effect.forEach(input.embeddingCache, (entry) =>
          Effect.gen(function* () {
            yield* validateVector(
              entry.embedding.vector,
              entry.embedding.dims,
              entry.embedding.dtype,
              entry.embedding.dims,
              entry.embedding.dtype,
            )
            yield* insertCache({
              contentHash: entry.contentHash,
              model: entry.model,
              dims: entry.embedding.dims,
              dtype: entry.embedding.dtype,
              embedding: copyVector(entry.embedding.vector),
            })
          }),
        )
        yield* insertMeta({
          id: 1,
          model: config.embedder.model,
          dims: input.dims,
          dtype: input.dtype,
          lastIndex: Date.now(),
        })
        const shouldQuantize =
          config.vectorSearch.mode === "turboquant" ||
          (config.vectorSearch.mode === "auto" &&
            ordinal >= config.vectorSearch.turboQuantThreshold)
        if (shouldQuantize && ordinal > 0) yield* buildQuantization(input.dims)
      })

      yield* sql
        .withTransaction(transaction)
        .pipe(Effect.mapError(asStoreError("persist index transaction")))
      const quantizationExpected =
        config.vectorSearch.mode === "turboquant" ||
        (config.vectorSearch.mode === "auto" && ordinal >= config.vectorSearch.turboQuantThreshold)
      if (!quantizationExpected || ordinal === 0) yield* Ref.set(quantized, false)
      yield* removeLegacyIndexFiles().pipe(
        Effect.mapError(asStoreError("remove obsolete flat index files")),
      )
      return { chunks: ordinal, files: seenFiles.size, totalLines, byteSize }
    })

  const loadSearchData = (): Effect.Effect<
    SearchData,
    StoreError | NoIndexError | DtypeMismatchError | VectorDecodeError
  > =>
    Effect.gen(function* () {
      const meta = yield* requireMeta()
      const config = yield* configStore
        .readConfig()
        .pipe(Effect.mapError(asStoreError("read config for search")))
      if (meta.dtype !== config.embedder.dtype) {
        return yield* new DtypeMismatchError({
          message: `Index was built with dtype "${meta.dtype}" but config expects "${config.embedder.dtype}". Re-index to fix.`,
          storedDtype: meta.dtype,
          configDtype: config.embedder.dtype,
        })
      }
      const entries = toMetadata(yield* readChunkMetadata())
      const indexes = yield* readRetrievalIndexes()
      return {
        entries,
        bm25Index: indexes.bm25Index,
        identifierIndex: indexes.identifierIndex,
        malformedLines: 0,
      }
    })

  const searchDense = (
    embedding: Embedding,
  ): Effect.Effect<readonly RankedChunk[], StoreError | NoIndexError | VectorDecodeError> =>
    Effect.gen(function* () {
      const meta = yield* requireMeta()
      if (embedding.dims !== meta.dims || embedding.vector.length !== meta.dims) {
        return yield* new VectorDecodeError({
          message: `Query vector dimensions do not match index: expected ${meta.dims}, got ${embedding.vector.length}`,
          dtype: "fp32",
        })
      }
      const config = yield* configStore
        .readConfig()
        .pipe(Effect.mapError(asStoreError("read vector search config")))
      const status = yield* selectStatus(undefined).pipe(
        Effect.mapError(asStoreError("count vectors for search")),
      )
      const useQuantization =
        config.vectorSearch.mode === "turboquant" ||
        (config.vectorSearch.mode === "auto" &&
          status.chunks >= config.vectorSearch.turboQuantThreshold)

      yield* initializeVectors(meta.dims).pipe(
        Effect.mapError(asStoreError("initialize vector search")),
      )
      if (useQuantization && !(yield* Ref.get(quantized))) {
        yield* buildQuantization(meta.dims).pipe(
          Effect.mapError(asStoreError("build TurboQuant index")),
        )
      }
      const matches = yield* (useQuantization ? quantizedDenseSearch : exactDenseSearch)({
        embedding: copyVector(embedding.vector),
      }).pipe(Effect.mapError(asStoreError("search vectors")))
      return matches.map(({ ordinal, distance }) => ({
        chunkIndex: ordinal,
        score: 1 - distance,
      }))
    })

  const loadEmbeddingCache = (): Effect.Effect<readonly CachedEmbedding[], StoreError> =>
    selectCache(undefined).pipe(
      Effect.map((rows) =>
        rows
          .filter((row) => row.embedding.length === row.dims)
          .map((row) => ({
            contentHash: row.contentHash,
            model: row.model,
            embedding: { vector: row.embedding, dims: row.dims, dtype: row.dtype },
          })),
      ),
      Effect.mapError(asStoreError("read embedding cache")),
    )

  const clearEmbeddingCache = (): Effect.Effect<boolean, StoreError> =>
    Effect.gen(function* () {
      const { count } = yield* selectCacheCount(undefined)
      yield* sql`DELETE FROM embedding_cache`
      return count > 0
    }).pipe(Effect.mapError(asStoreError("clear embedding cache")))

  const loadIndexSnapshot = (): Effect.Effect<Option.Option<IndexSnapshot>, StoreError> =>
    Effect.gen(function* () {
      const meta = yield* readMeta()
      if (Option.isNone(meta)) return Option.none()
      const rows = yield* readChunks()
      const entries = yield* toEntries(rows, meta.value.dims).pipe(
        Effect.mapError(asStoreError("decode index snapshot vectors")),
      )
      const indexes = yield* readRetrievalIndexes()
      const files = yield* selectFiles(undefined).pipe(
        Effect.mapError(asStoreError("read file manifest")),
      )
      const indexMeta: IndexMeta = {
        model: meta.value.model,
        dims: meta.value.dims,
        dtype: meta.value.dtype,
        lastIndex: meta.value.lastIndex,
      }
      const manifest: readonly FileManifestEntry[] = files
      return Option.some({
        entries,
        bm25Index: indexes.bm25Index,
        identifierIndex: indexes.identifierIndex,
        malformedLines: 0,
        meta: indexMeta,
        files: manifest,
      })
    })

  const loadSource = (request: SourceRequest): Effect.Effect<SourceContent, StoreError> =>
    Effect.gen(function* () {
      const source = yield* fs
        .readFileString(request.file)
        .pipe(Effect.mapError(asStoreError(`read selected source ${request.file}`)))
      const text = source.slice(request.startOffset, request.endOffset)
      if (contentHash(text) !== request.contentHash) {
        return yield* new StoreError({
          message: `Source changed since indexing: ${request.file}. Refresh the index and retry.`,
          path: request.file,
        })
      }
      const stripCarriageReturn = (line: string): string => line.replace(/\r$/u, "")
      const lines = source.split("\n")
      const beforeStart = Math.max(0, request.startLine - 1 - request.contextLines)
      const afterEnd = Math.min(lines.length, request.endLine + request.contextLines)
      return {
        text,
        contextBefore:
          lines
            .slice(beforeStart, request.startLine - 1)
            .map(stripCarriageReturn)
            .join("\n") || null,
        contextAfter:
          lines.slice(request.endLine, afterEnd).map(stripCarriageReturn).join("\n") || null,
      }
    })

  const getStatus = () =>
    Effect.gen(function* () {
      const meta = yield* readMeta()
      if (Option.isNone(meta)) return emptyStatus
      const status = yield* selectStatus(undefined).pipe(
        Effect.mapError(asStoreError("read index status")),
      )
      return {
        ...status,
        model: meta.value.model,
        lastIndex: meta.value.lastIndex,
        validationErrors: [],
      }
    })

  const reset = (): Effect.Effect<
    { deletedChunks: boolean; deletedVectors: boolean; freedBytes: number },
    StoreError
  > =>
    Effect.gen(function* () {
      const meta = yield* readMeta()
      if (Option.isNone(meta)) {
        return { deletedChunks: false, deletedVectors: false, freedBytes: 0 }
      }
      const status = yield* selectStatus(undefined)
      yield* sql.withTransaction(
        Effect.gen(function* () {
          yield* sql`DELETE FROM index_meta`
          yield* sql`DELETE FROM retrieval_indexes`
          yield* sql`DELETE FROM files`
          yield* sql`DELETE FROM chunks`
          yield* Ref.set(quantized, false)
        }),
      )
      return {
        deletedChunks: status.chunks > 0,
        deletedVectors: status.chunks > 0,
        freedBytes: status.byteSize,
      }
    }).pipe(Effect.mapError(asStoreError("reset index")))

  return {
    persistIndex,
    loadSearchData,
    searchDense,
    loadSource,
    loadEmbeddingCache,
    clearEmbeddingCache,
    loadIndexSnapshot,
    getStatus,
    reset,
  } as const
})

/** SQLite-backed IndexStore adapter without its ConfigStore, FileSystem, or database dependencies. */
export const SqliteIndexStoreBase = Layer.effect(IndexStore, make)

/** Production SQLite-backed IndexStore adapter. */
export const SqliteIndexStoreLive = Layer.provideMerge(
  SqliteIndexStoreBase,
  Layer.merge(ConfigStoreLive, SqliteIndexDatabaseLive),
)
