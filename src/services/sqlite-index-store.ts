import { Effect, Layer, Option, Schema, Stream } from "effect"
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
  CachedSparseEmbedding,
  IndexSnapshot,
  IndexStats,
  PersistIndexInput,
  RankedChunk,
  SearchData,
  SourceContent,
  SourceRequest,
} from "../domain/ports.js"
import { sparseContractsEqual } from "../domain/sparse.js"
import type { SparseContract, SparseQuery, SparseTerm, SparseVector } from "../domain/sparse.js"
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
  SparseIdfRow,
  SparseIndexMetaRow,
  SparseEmbeddingCacheRow,
  SparseMatchRow,
  SparseTermRow,
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

  const insertMeta = SqlSchema.void({
    Request: IndexMetaRow.insert,
    execute: ({ id, model, dims, dtype, lastIndex, quantized }) => sql`
      INSERT INTO index_meta (id, model, dims, dtype, last_index, quantized)
      VALUES (${id}, ${model}, ${dims}, ${dtype}, ${lastIndex}, ${quantized})
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

  const insertSparseMeta = SqlSchema.void({
    Request: SparseIndexMetaRow.insert,
    execute: ({
      id,
      model,
      modelRevision,
      tokenizer,
      tokenizerRevision,
      idfRevision,
      idfContentHash,
    }) =>
      sql`INSERT INTO sparse_index_meta (
        id, model, model_revision, tokenizer, tokenizer_revision, idf_revision, idf_content_hash
      ) VALUES (
        ${id}, ${model}, ${modelRevision}, ${tokenizer}, ${tokenizerRevision}, ${idfRevision},
        ${idfContentHash}
      )`,
  })

  const insertSparseTerms = (chunkOrdinal: number, vector: SparseVector) => {
    return Effect.gen(function* () {
      for (let start = 0; start < vector.terms.length; start += 500) {
        const values = sql.join(
          ", ",
          false,
        )(
          vector.terms
            .slice(start, start + 500)
            .map(({ tokenId, weight }) => sql`(${chunkOrdinal}, ${tokenId}, ${weight})`),
        )
        yield* sql`INSERT INTO sparse_terms (chunk_ordinal, token_id, weight) VALUES ${values}`
      }
    })
  }

  const insertSparseIdf = (terms: readonly SparseTerm[]) => {
    return Effect.gen(function* () {
      for (let start = 0; start < terms.length; start += 500) {
        const values = sql.join(
          ", ",
          false,
        )(
          terms
            .slice(start, start + 500)
            .map(({ tokenId, weight }) => sql`(${tokenId}, ${weight})`),
        )
        yield* sql`INSERT INTO sparse_idf (token_id, weight) VALUES ${values}`
      }
    })
  }

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

  const insertSparseCache = SqlSchema.void({
    Request: SparseEmbeddingCacheRow.insert,
    execute: ({
      contentHash,
      model,
      modelRevision,
      tokenizer,
      tokenizerRevision,
      idfRevision,
      idfContentHash,
      vector,
    }) => sql`
      INSERT OR REPLACE INTO sparse_embedding_cache (
        content_hash, model, model_revision, tokenizer, tokenizer_revision,
        idf_revision, idf_content_hash, vector_json
      ) VALUES (
        ${contentHash}, ${model}, ${modelRevision}, ${tokenizer}, ${tokenizerRevision},
        ${idfRevision}, ${idfContentHash}, ${vector}
      )
    `,
  })

  const selectMeta = SqlSchema.findOneOption({
    Request: Schema.Void,
    Result: IndexMetaRow,
    execute: () => sql`
      SELECT id, model, dims, dtype, last_index, quantized FROM index_meta WHERE id = 1
    `,
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

  const selectSparseMeta = SqlSchema.findOneOption({
    Request: Schema.Void,
    Result: SparseIndexMetaRow,
    execute: () => sql`SELECT
      id, model, model_revision, tokenizer, tokenizer_revision, idf_revision, idf_content_hash
      FROM sparse_index_meta WHERE id = 1`,
  })

  const selectSparseTerms = SqlSchema.findAll({
    Request: Schema.Void,
    Result: SparseTermRow,
    execute: () => sql`SELECT chunk_ordinal, token_id, weight
      FROM sparse_terms ORDER BY chunk_ordinal, token_id`,
  })

  const selectSparseIdf = SqlSchema.findAll({
    Request: Schema.Void,
    Result: SparseIdfRow,
    execute: () => sql`SELECT token_id, weight FROM sparse_idf ORDER BY token_id`,
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

  const selectSparseCache = SqlSchema.findAll({
    Request: Schema.Void,
    Result: SparseEmbeddingCacheRow,
    execute: () => sql`
      SELECT content_hash, model, model_revision, tokenizer, tokenizer_revision,
             idf_revision, idf_content_hash, vector_json AS vector
      FROM sparse_embedding_cache
      ORDER BY content_hash, model, model_revision, tokenizer_revision
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
        COALESCE(SUM(length(embedding)), 0) +
          (SELECT COUNT(*) * 12 FROM sparse_terms) +
          (SELECT COUNT(*) * 12 FROM sparse_idf) AS byte_size
      FROM chunks
    `,
  })

  const selectCacheCount = SqlSchema.findOne({
    Request: Schema.Void,
    Result: CacheCountRow,
    execute: () => sql`SELECT COUNT(*) AS count FROM embedding_cache`,
  })

  const selectSparseCacheCount = SqlSchema.findOne({
    Request: Schema.Void,
    Result: CacheCountRow,
    execute: () => sql`SELECT COUNT(*) AS count FROM sparse_embedding_cache`,
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

  const requireSparseContract = (): Effect.Effect<SparseContract, StoreError | NoIndexError> =>
    Effect.gen(function* () {
      const meta = yield* selectSparseMeta(undefined).pipe(
        Effect.mapError(asStoreError("read sparse index metadata")),
      )
      if (Option.isNone(meta)) {
        return yield* new NoIndexError({
          message: "Sparse index data is missing. Re-index to fix.",
        })
      }
      const { id: _id, ...contract } = meta.value
      return contract
    })

  const readChunks = (): Effect.Effect<readonly ChunkRow[], StoreError> =>
    selectChunks(undefined).pipe(Effect.mapError(asStoreError("read chunks")))

  const readSparseTerms = (): Effect.Effect<readonly SparseTermRow[], StoreError> =>
    selectSparseTerms(undefined).pipe(Effect.mapError(asStoreError("read sparse terms")))

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
    sparseRows: readonly SparseTermRow[],
  ): Effect.Effect<readonly ChunkEntry[], VectorDecodeError> =>
    Effect.gen(function* () {
      const termsByOrdinal = new Map<number, SparseTerm[]>()
      for (const row of sparseRows) {
        const terms = termsByOrdinal.get(row.chunkOrdinal) ?? []
        terms.push({ tokenId: row.tokenId, weight: row.weight })
        termsByOrdinal.set(row.chunkOrdinal, terms)
      }
      return yield* Effect.forEach(rows, (row) =>
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
              sparseVector: { terms: termsByOrdinal.get(row.ordinal) ?? [] },
            })
          : Effect.fail(
              new VectorDecodeError({
                message: `Invalid vector dimensions for chunk ${row.id}: expected ${dims}, got ${row.embedding.length}`,
                dtype: "fp32",
              }),
            ),
      )
    })

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
      yield* sql`UPDATE index_meta SET quantized = 1 WHERE id = 1`
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
        yield* sql`DELETE FROM sparse_terms`
        yield* sql`DELETE FROM sparse_idf`
        yield* sql`DELETE FROM sparse_index_meta`
        yield* sql`DELETE FROM index_meta`
        yield* sql`DELETE FROM retrieval_indexes`
        yield* sql`DELETE FROM files`
        yield* sql`DELETE FROM chunks`
        yield* sql`DELETE FROM embedding_cache`
        yield* sql`DELETE FROM sparse_embedding_cache`

        yield* Stream.runForEach(input.chunks, (batch) =>
          Effect.forEach(batch, ([chunk, embedding, sparseVector]) =>
            Effect.gen(function* () {
              yield* validateVector(
                embedding.vector,
                embedding.dims,
                embedding.dtype,
                input.dims,
                input.dtype,
              )
              yield* insertChunk({ ordinal, ...chunk, embedding: copyVector(embedding.vector) })
              yield* insertSparseTerms(ordinal, sparseVector)
              ordinal++
              totalLines += chunk.endLine - chunk.startLine + 1
              byteSize += embedding.vector.byteLength + sparseVector.terms.length * 12
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
        yield* insertSparseMeta({ id: 1, ...input.sparseContract })
        yield* insertSparseIdf(input.sparseIdf)
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
        yield* Effect.forEach(input.sparseEmbeddingCache, (entry) =>
          insertSparseCache({
            contentHash: entry.contentHash,
            model: entry.contract.model,
            modelRevision: entry.contract.modelRevision,
            tokenizer: entry.contract.tokenizer,
            tokenizerRevision: entry.contract.tokenizerRevision,
            idfRevision: entry.contract.idfRevision,
            idfContentHash: entry.contract.idfContentHash,
            vector: entry.vector,
          }),
        )
        yield* insertMeta({
          id: 1,
          model: config.embedder.model,
          dims: input.dims,
          dtype: input.dtype,
          lastIndex: Date.now(),
          quantized: 0,
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
      if (useQuantization && meta.quantized === 0) {
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

  const searchSparse = (
    query: SparseQuery,
  ): Effect.Effect<readonly RankedChunk[], StoreError | NoIndexError> =>
    Effect.gen(function* () {
      const contract = yield* requireSparseContract()
      if (!sparseContractsEqual(contract, query.contract)) {
        return yield* new StoreError({
          message: "Sparse query contract does not match the persisted index. Re-index to fix.",
        })
      }
      if (query.tokenIds.length === 0) return []

      const values = sql.join(", ", false)(query.tokenIds.map((tokenId) => sql`(${tokenId})`))
      const search = SqlSchema.findAll({
        Request: Schema.Void,
        Result: SparseMatchRow,
        execute: () => sql`
          WITH query_tokens(token_id) AS (VALUES ${values})
          SELECT sparse_terms.chunk_ordinal AS ordinal,
                 SUM(sparse_idf.weight * sparse_terms.weight) AS score
          FROM query_tokens
          JOIN sparse_idf ON sparse_idf.token_id = query_tokens.token_id
          JOIN sparse_terms ON sparse_terms.token_id = query_tokens.token_id
          GROUP BY sparse_terms.chunk_ordinal
          ORDER BY score DESC, sparse_terms.chunk_ordinal ASC
        `,
      })
      const matches = yield* search(undefined).pipe(
        Effect.mapError(asStoreError("search sparse index")),
      )
      return matches.map(({ ordinal, score }) => ({ chunkIndex: ordinal, score }))
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

  const loadSparseEmbeddingCache = (): Effect.Effect<
    readonly CachedSparseEmbedding[],
    StoreError
  > =>
    selectSparseCache(undefined).pipe(
      Effect.map((rows) =>
        rows.map((row) => ({
          contentHash: row.contentHash,
          contract: {
            model: row.model,
            modelRevision: row.modelRevision,
            tokenizer: row.tokenizer,
            tokenizerRevision: row.tokenizerRevision,
            idfRevision: row.idfRevision,
            idfContentHash: row.idfContentHash,
          },
          vector: row.vector,
        })),
      ),
      Effect.mapError(asStoreError("read sparse embedding cache")),
    )

  const clearEmbeddingCache = (): Effect.Effect<boolean, StoreError> =>
    Effect.gen(function* () {
      const [{ count: denseCount }, { count: sparseCount }] = yield* Effect.all([
        selectCacheCount(undefined),
        selectSparseCacheCount(undefined),
      ])
      yield* sql`DELETE FROM embedding_cache`
      yield* sql`DELETE FROM sparse_embedding_cache`
      return denseCount + sparseCount > 0
    }).pipe(Effect.mapError(asStoreError("clear embedding cache")))

  const loadIndexSnapshot = (): Effect.Effect<Option.Option<IndexSnapshot>, StoreError> =>
    Effect.gen(function* () {
      const meta = yield* readMeta()
      if (Option.isNone(meta)) return Option.none()
      const sparseMeta = yield* selectSparseMeta(undefined).pipe(
        Effect.mapError(asStoreError("read sparse index metadata")),
      )
      if (Option.isNone(sparseMeta)) return Option.none()
      const rows = yield* readChunks()
      const sparseRows = yield* readSparseTerms()
      const sparseIdf = yield* selectSparseIdf(undefined).pipe(
        Effect.mapError(asStoreError("read sparse IDF")),
      )
      const entries = yield* toEntries(rows, meta.value.dims, sparseRows).pipe(
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
      const { id: _id, ...sparseContract } = sparseMeta.value
      return Option.some({
        entries,
        bm25Index: indexes.bm25Index,
        identifierIndex: indexes.identifierIndex,
        malformedLines: 0,
        meta: indexMeta,
        files: manifest,
        sparseContract,
        sparseIdf,
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
          yield* sql`DELETE FROM sparse_terms`
          yield* sql`DELETE FROM sparse_idf`
          yield* sql`DELETE FROM sparse_index_meta`
          yield* sql`DELETE FROM index_meta`
          yield* sql`DELETE FROM retrieval_indexes`
          yield* sql`DELETE FROM files`
          yield* sql`DELETE FROM chunks`
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
    searchSparse,
    loadSource,
    loadEmbeddingCache,
    loadSparseEmbeddingCache,
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
