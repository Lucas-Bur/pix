import { Effect, Exit, Layer, Option, Ref, Schema, Stream } from "effect"
import { FileSystem } from "effect/FileSystem"

import type { Embedding } from "../domain/chunk.js"
import type { EmbeddingDtype, IndexMeta } from "../domain/dtype.js"
import { DtypeMismatchError, IndexMetaSchema, VectorDecodeError } from "../domain/dtype.js"
import { ChunkValidationError, DiskFullError, NoIndexError, StoreError } from "../domain/errors.js"
import type { IdentifierIndexMaps } from "../domain/identifier-index.js"
import {
  EmbeddingCacheEntrySchema,
  FileManifestEntrySchema,
  StoredChunkSchema,
} from "../domain/index-data.js"
import type { FileManifestEntry, StoredChunk } from "../domain/index-data.js"
import { ConfigStore, IndexStore } from "../domain/ports.js"
import type {
  Bm25Index,
  CachedEmbedding,
  ChunkEntry,
  IndexStats,
  PersistIndexInput,
  SearchData,
  SourceContent,
  SourceRequest,
} from "../domain/ports.js"
import { buildChunkValidationErrors } from "../lib/config/validation.js"
import { contentHash } from "../lib/content-hash.js"
import { ensureDirExists, withFsError, withReadError } from "../lib/errors/fs-error.js"
import {
  deserializeIdentifierIndex,
  serializeIdentifierIndex,
} from "../lib/retrieval/identifier-index.js"
import { serializeVectors } from "../lib/vectors/vector-serialization.js"
import { ConfigStoreLive } from "./config-store.js"

const parseChunkLine = (line: string): Effect.Effect<Option.Option<StoredChunk>> =>
  Schema.decodeUnknownEffect(parseJsonChunk)(line).pipe(Effect.option)

const STORE_DIR = ".pix"
const CHUNKS_FILE = `${STORE_DIR}/chunks.jsonl`
const VECTORS_FILE = `${STORE_DIR}/vectors.bin`
const META_FILE = `${STORE_DIR}/index-meta.json`
const BM25_FILE = `${STORE_DIR}/bm25.json`
const IDENTIFIERS_FILE = `${STORE_DIR}/identifiers.json`
const FILES_FILE = `${STORE_DIR}/files.jsonl`
const EMBEDDING_CACHE_FILE = `${STORE_DIR}/embedding-cache.jsonl`

/** Pre-built Schema instance for chunk encode/decode. */
const parseJsonChunk = Schema.fromJsonString(StoredChunkSchema)
const encodeFileManifestEntry = Schema.fromJsonString(FileManifestEntrySchema)
const encodeEmbeddingCacheEntry = Schema.fromJsonString(EmbeddingCacheEntrySchema)

const encodeEmbeddingVector = (vector: Float32Array): string =>
  Buffer.from(new Uint8Array(vector.buffer, vector.byteOffset, vector.byteLength)).toString(
    "base64",
  )

const decodeEmbeddingVector = (encoded: string): Float32Array => {
  const bytes = Buffer.from(encoded, "base64")
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return new Float32Array(copy.buffer)
}

const buildAndStoreBm25 = (
  fs: FileSystem,
  bm25Index: Bm25Index,
  bm25Path: string,
): Effect.Effect<void, StoreError | DiskFullError> =>
  Effect.gen(function* () {
    const encoded = yield* Schema.encodeEffect(Schema.fromJsonString(Bm25IndexSchema))(
      bm25Index,
    ).pipe(
      Effect.mapError((e) => new StoreError({ message: "Failed to encode BM25 index", cause: e })),
    )
    yield* withFsError(fs.writeFile(bm25Path, Buffer.from(encoded)), "write bm25 index", bm25Path)
  })

const Bm25IndexSchema = Schema.Struct({
  avgChunkLength: Schema.Number,
  chunkLengths: Schema.Array(Schema.Number),
  docFreqs: Schema.Record(Schema.String, Schema.Number),
  chunkTfs: Schema.Record(
    Schema.String,
    Schema.Array(Schema.Tuple([Schema.Number, Schema.Number])),
  ),
})

const loadBm25 = (fs: FileSystem, bm25Path: string): Effect.Effect<Bm25Index, StoreError> =>
  Effect.gen(function* () {
    const exists = yield* withReadError(fs.exists(bm25Path), "check bm25 index")
    if (!exists) {
      return yield* new StoreError({
        message: `Missing ${bm25Path} — index may be corrupted. Run pix reset and re-index.`,
      })
    }
    const content = yield* withReadError(fs.readFileString(bm25Path), "read bm25 index", bm25Path)
    return yield* Schema.decodeUnknownEffect(Schema.fromJsonString(Bm25IndexSchema))(content).pipe(
      Effect.mapError(
        () =>
          new StoreError({
            message: `Corrupted ${bm25Path} — index may be damaged. Run pix reset and re-index.`,
          }),
      ),
    )
  })

/**
 * FileSystem adapter for IndexStore port. Manages the full index lifecycle: chunks.jsonl,
 * vectors.bin, index-meta.json, and bm25.json.
 */
const make = Effect.gen(function* () {
  const fs = yield* FileSystem
  const configStore = yield* ConfigStore

  const chunksTemp = `${CHUNKS_FILE}.tmp`
  const vectorsTemp = `${VECTORS_FILE}.tmp`
  const metaTemp = `${META_FILE}.tmp`
  const bm25Temp = `${BM25_FILE}.tmp`
  const identifiersTemp = `${IDENTIFIERS_FILE}.tmp`
  const filesTemp = `${FILES_FILE}.tmp`
  const embeddingCacheTemp = `${EMBEDDING_CACHE_FILE}.tmp`
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
  const bm25IndexRef = yield* Ref.make<Bm25Index>({
    avgChunkLength: 0,
    chunkLengths: [],
    docFreqs: {},
    chunkTfs: {},
  })
  const loadEmbeddingCache = (): Effect.Effect<readonly CachedEmbedding[], StoreError> =>
    Effect.gen(function* () {
      const exists = yield* withReadError(fs.exists(EMBEDDING_CACHE_FILE), "check embedding cache")
      if (!exists) return []
      const content = yield* withReadError(
        fs.readFileString(EMBEDDING_CACHE_FILE),
        "read embedding cache",
        EMBEDDING_CACHE_FILE,
      )
      const entries: CachedEmbedding[] = []
      for (const line of content.split("\n").filter((value) => value.trim().length > 0)) {
        const decodedResult = yield* Schema.decodeUnknownEffect(encodeEmbeddingCacheEntry)(
          line,
        ).pipe(Effect.option)
        if (Option.isNone(decodedResult)) continue
        const decoded = decodedResult.value
        const vector = decodeEmbeddingVector(decoded.vector)
        if (vector.length !== decoded.dims) continue
        entries.push({
          contentHash: decoded.contentHash,
          model: decoded.model,
          embedding: { vector, dims: decoded.dims, dtype: decoded.dtype },
        })
      }
      return entries
    })

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
          totalLines += chunk.value.endLine - chunk.value.startLine + 1
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
      return yield* Schema.decodeUnknownEffect(Schema.fromJsonString(IndexMetaSchema))(
        content,
      ).pipe(
        Effect.mapError((e) => new StoreError({ message: "Corrupted index-meta.json", cause: e })),
      )
    })

  /** Load index meta, read config, and validate dtype compatibility. */
  const loadAndValidateMeta = (): Effect.Effect<
    { dims: number },
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
      if (indexMeta.dtype !== config.embedder.dtype) {
        return yield* new DtypeMismatchError({
          message: `Index was built with dtype "${indexMeta.dtype}" but config expects "${config.embedder.dtype}". Re-index to fix.`,
          storedDtype: indexMeta.dtype,
          configDtype: config.embedder.dtype,
        })
      }
      return { dims: indexMeta.dims }
    })

  /** Read chunks.jsonl and vectors.bin. Vectors are stored as Float32Array bytes (see ADR-0008). */
  const loadChunksAndVectors = (
    dims: number,
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
      const expectedBytes = chunkLines.length * dims * Float32Array.BYTES_PER_ELEMENT
      if (vectorsBuffer.byteLength !== expectedBytes) {
        return yield* new VectorDecodeError({
          message: `Invalid vector buffer length: expected ${expectedBytes}, got ${vectorsBuffer.byteLength}`,
          dtype: "fp32",
        })
      }
      // Node.js fs.readFile may return a Buffer with a non-4-aligned byteOffset
      // due to shared memory pooling, which would cause Float32Array to throw RangeError.
      const aligned =
        vectorsBuffer.byteOffset % Float32Array.BYTES_PER_ELEMENT === 0
          ? new Float32Array(
              vectorsBuffer.buffer,
              vectorsBuffer.byteOffset,
              chunkLines.length * dims,
            )
          : new Float32Array(new Uint8Array(vectorsBuffer).buffer, 0, chunkLines.length * dims)
      return { chunkLines, vectors: aligned, dims }
    })

  /** Read and parse chunks.jsonl and vectors.bin, with dtype validation from index-meta.json. */
  const loadIndex = (): Effect.Effect<
    { chunkLines: string[]; vectors: Float32Array; dims: number },
    StoreError | NoIndexError | DtypeMismatchError | VectorDecodeError
  > =>
    Effect.gen(function* () {
      const { dims } = yield* loadAndValidateMeta()
      return yield* loadChunksAndVectors(dims)
    })

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
      const identifiersExists = yield* withFsError(
        fs.exists(identifiersTemp),
        "check identifiers temp",
      )
      if (identifiersExists) {
        yield* withFsError(
          fs.remove(identifiersTemp),
          "clean stale identifiers temp",
          identifiersTemp,
        )
      }
      const filesExists = yield* withFsError(fs.exists(filesTemp), "check files temp")
      if (filesExists) {
        yield* withFsError(fs.remove(filesTemp), "clean stale files temp", filesTemp)
      }
      const embeddingCacheExists = yield* withFsError(
        fs.exists(embeddingCacheTemp),
        "check embedding cache temp",
      )
      if (embeddingCacheExists) {
        yield* withFsError(
          fs.remove(embeddingCacheTemp),
          "clean stale embedding cache temp",
          embeddingCacheTemp,
        )
      }
      yield* withFsError(
        fs.writeFile(chunksTemp, Buffer.alloc(0)),
        "create chunks temp",
        chunksTemp,
      )
      yield* withFsError(
        fs.writeFile(vectorsTemp, Buffer.alloc(0)),
        "create vectors temp",
        vectorsTemp,
      )
    })

  const storeBatch = (
    chunks: readonly StoredChunk[],
    embeddings: readonly Embedding[],
  ): Effect.Effect<void, StoreError | DiskFullError> =>
    Effect.gen(function* () {
      const lines = yield* Effect.forEach(chunks, (chunk) =>
        Schema.encodeEffect(parseJsonChunk)(chunk).pipe(
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

  const storeFileManifest = (
    files: readonly FileManifestEntry[],
  ): Effect.Effect<void, StoreError | DiskFullError> =>
    Effect.gen(function* () {
      const lines = yield* Effect.forEach(files, (file) =>
        Schema.encodeEffect(encodeFileManifestEntry)(file).pipe(
          Effect.mapError(
            (cause) => new StoreError({ message: "Failed to encode file manifest", cause }),
          ),
        ),
      )
      yield* withFsError(
        fs.writeFile(filesTemp, Buffer.from(lines.length > 0 ? `${lines.join("\n")}\n` : "")),
        "write files temp",
        filesTemp,
      )
    })

  const storeEmbeddingCache = (
    cache: readonly CachedEmbedding[],
  ): Effect.Effect<void, StoreError | DiskFullError> =>
    Effect.gen(function* () {
      const lines = yield* Effect.forEach(cache, (entry) =>
        Schema.encodeEffect(encodeEmbeddingCacheEntry)({
          contentHash: entry.contentHash,
          model: entry.model,
          dims: entry.embedding.dims,
          dtype: entry.embedding.dtype,
          vector: encodeEmbeddingVector(entry.embedding.vector),
        }).pipe(
          Effect.mapError(
            (cause) => new StoreError({ message: "Failed to encode embedding cache", cause }),
          ),
        ),
      )
      yield* withFsError(
        fs.writeFile(
          embeddingCacheTemp,
          Buffer.from(lines.length > 0 ? `${lines.join("\n")}\n` : ""),
        ),
        "write embedding cache temp",
        embeddingCacheTemp,
      )
    })

  const storeIdentifierIndex = (
    maps: IdentifierIndexMaps,
  ): Effect.Effect<void, StoreError | DiskFullError> =>
    Effect.gen(function* () {
      const json = serializeIdentifierIndex(maps)
      yield* withFsError(
        fs.writeFile(identifiersTemp, Buffer.from(json)),
        "write identifiers temp",
        identifiersTemp,
      )
    })

  const storeCommit = (): Effect.Effect<IndexStats, StoreError | DiskFullError> =>
    Effect.gen(function* () {
      const config = yield* configStore
        .readConfig()
        .pipe(
          Effect.mapError(
            (cause) => new StoreError({ message: "Failed to read config for index commit", cause }),
          ),
        )
      const { dims, dtype } = yield* Ref.get(batchMetaRef)
      const indexMeta: IndexMeta = {
        dtype,
        dims,
        model: config.embedder.model,
        lastIndex: Date.now(),
      }

      yield* Effect.gen(function* () {
        yield* withFsError(
          fs.writeFile(metaTemp, Buffer.from(JSON.stringify(indexMeta))),
          "write index meta",
          metaTemp,
        )
        const bm25Index = yield* Ref.get(bm25IndexRef)
        yield* buildAndStoreBm25(fs, bm25Index, bm25Temp)
      }).pipe(
        Effect.catch((err) => storeAbort().pipe(Effect.ignore, Effect.andThen(Effect.fail(err)))),
      )

      yield* withFsError(fs.rename(metaTemp, META_FILE), "commit index meta", META_FILE)
      yield* withFsError(fs.rename(bm25Temp, BM25_FILE), "commit bm25 index", BM25_FILE)
      yield* withFsError(
        fs.rename(identifiersTemp, IDENTIFIERS_FILE),
        "commit identifiers",
        IDENTIFIERS_FILE,
      )
      yield* withFsError(fs.rename(filesTemp, FILES_FILE), "commit files", FILES_FILE)
      yield* withFsError(
        fs.rename(embeddingCacheTemp, EMBEDDING_CACHE_FILE),
        "commit embedding cache",
        EMBEDDING_CACHE_FILE,
      )
      yield* withFsError(fs.rename(chunksTemp, CHUNKS_FILE), "commit chunks", CHUNKS_FILE)
      yield* withFsError(fs.rename(vectorsTemp, VECTORS_FILE), "commit vectors", VECTORS_FILE)

      const stats = yield* Ref.get(statsAccumulator)
      const files = yield* Ref.get(seenFiles)
      yield* Ref.set(seenFiles, new Set())
      return { ...stats, files: files.size }
    })

  const removeTempIfExists = (file: string, description: string): Effect.Effect<void, StoreError> =>
    Effect.gen(function* () {
      const exists = yield* withReadError(fs.exists(file), `check ${description}`)
      if (exists) {
        yield* withReadError(fs.remove(file), `abort ${description}`, file)
      }
    })

  const storeAbort = (): Effect.Effect<void, StoreError> =>
    Effect.gen(function* () {
      yield* Ref.set(seenFiles, new Set())
      yield* removeTempIfExists(chunksTemp, "chunks temp")
      yield* removeTempIfExists(vectorsTemp, "vectors temp")
      yield* removeTempIfExists(metaTemp, "index meta temp")
      yield* removeTempIfExists(bm25Temp, "bm25 temp")
      yield* removeTempIfExists(identifiersTemp, "identifiers temp")
      yield* removeTempIfExists(filesTemp, "files temp")
      yield* removeTempIfExists(embeddingCacheTemp, "embedding cache temp")
    })

  const parseChunkEntries = (
    chunkLines: string[],
    vectors: Float32Array,
    dims: number,
  ): { entries: ChunkEntry[]; malformedLines: number } => {
    const entries: ChunkEntry[] = []
    let malformedLines = 0
    for (let i = 0; i < chunkLines.length; i++) {
      let chunk: StoredChunk
      try {
        chunk = Schema.decodeUnknownSync(parseJsonChunk)(chunkLines[i])
      } catch {
        malformedLines++
        continue
      }
      const startIdx = i * dims
      entries.push({
        ...chunk,
        index: i,
        vector: vectors.subarray(startIdx, startIdx + dims),
      })
    }
    return { entries, malformedLines }
  }

  const loadBm25Index = (): Effect.Effect<Bm25Index, StoreError> => loadBm25(fs, BM25_FILE)

  /**
   * Load the identifier index from disk. Returns empty maps if the file is missing (the index
   * predates this feature or the user disabled identifier extraction) so the query can still run --
   * the identity and camelCase scorers will just produce empty results.
   */
  const loadIdentifierIndex = (): Effect.Effect<IdentifierIndexMaps, StoreError> =>
    Effect.gen(function* () {
      const exists = yield* withReadError(fs.exists(IDENTIFIERS_FILE), "check identifiers file")
      if (!exists) return { exact: {}, split: {} }
      const content = yield* withReadError(
        fs.readFileString(IDENTIFIERS_FILE),
        "read identifiers",
        IDENTIFIERS_FILE,
      )
      return yield* Effect.try({
        try: () => deserializeIdentifierIndex(content),
        catch: (cause) =>
          new StoreError({
            message: `Corrupted ${IDENTIFIERS_FILE} -- index may be damaged. Run pix reset and re-index.`,
            path: IDENTIFIERS_FILE,
            cause,
          }),
      })
    })

  const loadFileManifest = (): Effect.Effect<readonly FileManifestEntry[], StoreError> =>
    Effect.gen(function* () {
      const content = yield* withReadError(
        fs.readFileString(FILES_FILE),
        "read file manifest",
        FILES_FILE,
      )
      return yield* Effect.forEach(
        content.split("\n").filter((line) => line.trim().length > 0),
        (line) =>
          Schema.decodeUnknownEffect(encodeFileManifestEntry)(line).pipe(
            Effect.mapError(
              (cause) => new StoreError({ message: "Corrupted file manifest", cause }),
            ),
          ),
      )
    })

  const loadIndexSnapshot = (): Effect.Effect<
    Option.Option<{
      entries: readonly ChunkEntry[]
      bm25Index: Bm25Index
      identifierIndex: IdentifierIndexMaps
      malformedLines: number
      meta: IndexMeta
      files: readonly FileManifestEntry[]
    }>,
    StoreError
  > =>
    Effect.gen(function* () {
      const exists = yield* checkIndexExists()
      if (!exists) return Option.none()
      const meta = yield* readIndexMeta()
      if (!meta) return yield* new StoreError({ message: "Index meta file missing" })
      const { chunkLines, vectors, dims } = yield* loadChunksAndVectors(meta.dims).pipe(
        Effect.mapError(
          (cause) => new StoreError({ message: "Failed to decode index snapshot", cause }),
        ),
      )
      const { entries, malformedLines } = parseChunkEntries(chunkLines, vectors, dims)
      const bm25Index = yield* loadBm25Index()
      const identifierIndex = yield* loadIdentifierIndex()
      const files = yield* loadFileManifest()
      return Option.some({ entries, bm25Index, identifierIndex, malformedLines, meta, files })
    })

  const loadSource = (request: SourceRequest): Effect.Effect<SourceContent, StoreError> =>
    Effect.gen(function* () {
      const source = yield* withReadError(
        fs.readFileString(request.file),
        "read selected source",
        request.file,
      )
      const text = source.slice(request.startOffset, request.endOffset)
      if (contentHash(text) !== request.contentHash) {
        return yield* new StoreError({
          message: `Source changed since indexing: ${request.file}. Refresh the index and retry.`,
          path: request.file,
        })
      }
      const lines = source.split("\n")
      const beforeStart = Math.max(0, request.startLine - 1 - request.contextLines)
      const afterEnd = Math.min(lines.length, request.endLine + request.contextLines)
      return {
        text,
        contextBefore:
          lines
            .slice(beforeStart, request.startLine - 1)
            .join("\n")
            .replace(/\r$/u, "") || null,
        contextAfter: lines.slice(request.endLine, afterEnd).join("\n").replace(/\r$/u, "") || null,
      }
    })

  const loadSearchData = (): Effect.Effect<
    SearchData,
    StoreError | NoIndexError | DtypeMismatchError | VectorDecodeError
  > =>
    Effect.gen(function* () {
      const { chunkLines, vectors, dims } = yield* loadIndex()
      const { entries, malformedLines } = parseChunkEntries(chunkLines, vectors, dims)
      const bm25Index = yield* loadBm25Index()
      const identifierIndex = yield* loadIdentifierIndex()
      return { entries, bm25Index, identifierIndex, malformedLines }
    })

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
      const bm25 = yield* removeIfExists(BM25_FILE, "bm25 index")
      const identifiers = yield* removeIfExists(IDENTIFIERS_FILE, "identifiers")
      const files = yield* removeIfExists(FILES_FILE, "file manifest")

      return {
        deletedChunks: chunks.deleted,
        deletedVectors: vectors.deleted,
        freedBytes:
          chunks.freed + vectors.freed + meta.freed + bm25.freed + identifiers.freed + files.freed,
      }
    })

  const clearEmbeddingCache = (): Effect.Effect<boolean, StoreError | DiskFullError> =>
    Effect.gen(function* () {
      const removed = yield* removeIfExists(EMBEDDING_CACHE_FILE, "embedding cache")
      return removed.deleted
    })

  const persistIndex = <E>(
    input: PersistIndexInput<E>,
  ): Effect.Effect<IndexStats, StoreError | DiskFullError | E> =>
    Effect.gen(function* () {
      yield* storeBegin()
      yield* Ref.set(bm25IndexRef, input.bm25Index)
      yield* Ref.set(batchMetaRef, { dims: input.dims, dtype: input.dtype })
      const exit = yield* Effect.exit(
        Effect.gen(function* () {
          yield* Stream.runForEach(input.chunks, (batch) =>
            storeBatch(
              batch.map(([chunk]) => chunk),
              batch.map(([, embedding]) => embedding),
            ),
          )
          yield* storeIdentifierIndex(input.identifierIndex)
          yield* storeFileManifest(input.files)
          yield* storeEmbeddingCache(input.embeddingCache)
          return yield* storeCommit()
        }),
      )
      if (Exit.isSuccess(exit)) return exit.value
      yield* storeAbort()
      return yield* Effect.failCause(exit.cause)
    })

  return {
    persistIndex,
    loadSearchData,
    loadSource,
    loadEmbeddingCache,
    clearEmbeddingCache,
    loadIndexSnapshot,
    getStatus,
    reset,
  } as const
})

export const IndexStoreLive = Layer.provideMerge(Layer.effect(IndexStore, make), ConfigStoreLive)
