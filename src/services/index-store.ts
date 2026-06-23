import { FileSystem } from "@effect/platform"
import { Effect, Layer, Option, Ref, Schema } from "effect"

import { ChunkSchema } from "../domain/chunk.js"
import type { Chunk, Embedding } from "../domain/chunk.js"
import type { EmbeddingDtype, IndexMeta } from "../domain/dtype.js"
import { DtypeMismatchError, IndexMetaSchema, VectorDecodeError } from "../domain/dtype.js"
import { ChunkValidationError, DiskFullError, NoIndexError, StoreError } from "../domain/errors.js"
import { ConfigStore, IndexStore } from "../domain/ports.js"
import type { Bm25Index, ChunkEntry, IndexStats, SearchData } from "../domain/ports.js"
import { buildChunkValidationErrors } from "../lib/config/validation.js"
import { ensureDirExists, withFsError, withReadError } from "../lib/errors/fs-error.js"
import { buildBm25Index } from "../lib/retrieval/bm25.js"
import { serializeVectors } from "../lib/vectors/vector-serialization.js"
import { ConfigStoreLive } from "./config-store.js"

const parseChunkLine = (line: string): Effect.Effect<Option.Option<Chunk>> =>
  Schema.decodeUnknown(parseJsonChunk)(line).pipe(Effect.option)

const STORE_DIR = ".pix"
const CHUNKS_FILE = `${STORE_DIR}/chunks.jsonl`
const VECTORS_FILE = `${STORE_DIR}/vectors.bin`
const META_FILE = `${STORE_DIR}/index-meta.json`
const BM25_FILE = `${STORE_DIR}/bm25.json`

/** Pre-built Schema instance for chunk encode/decode. */
const parseJsonChunk = Schema.parseJson(ChunkSchema)

const buildAndStoreBm25 = (
  fs: FileSystem.FileSystem,
  chunksContent: string,
  bm25Path: string,
): Effect.Effect<void, StoreError | DiskFullError> =>
  Effect.gen(function* () {
    const chunkLines = chunksContent.split("\n").filter((l) => l.trim().length > 0)
    const texts: { index: number; text: string }[] = []
    for (let i = 0; i < chunkLines.length; i++) {
      try {
        const chunk = Schema.decodeUnknownSync(parseJsonChunk)(chunkLines[i])
        texts.push({ index: i, text: chunk.text })
      } catch {
        // skip malformed lines — bm25 ignores them
      }
    }
    const bm25Index = buildBm25Index(texts)
    yield* withFsError(
      fs.writeFile(bm25Path, Buffer.from(JSON.stringify(bm25Index))),
      "write bm25 index",
      bm25Path,
    )
  })

const loadBm25 = (
  fs: FileSystem.FileSystem,
  bm25Path: string,
): Effect.Effect<Bm25Index, StoreError> =>
  Effect.gen(function* () {
    const exists = yield* withReadError(fs.exists(bm25Path), "check bm25 index")
    if (!exists) {
      return yield* new StoreError({
        message: `Missing ${bm25Path} — index may be corrupted. Run pix reset and re-index.`,
      })
    }
    const content = yield* withReadError(fs.readFileString(bm25Path), "read bm25 index", bm25Path)
    try {
      return JSON.parse(content) as Bm25Index
    } catch {
      return yield* new StoreError({
        message: `Corrupted ${bm25Path} — index may be damaged. Run pix reset and re-index.`,
      })
    }
  })

/**
 * FileSystem adapter for IndexStore port. Manages the full index lifecycle: chunks.jsonl,
 * vectors.bin, index-meta.json, and bm25.json.
 */
const make = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem
  const configStore = yield* ConfigStore

  const chunksTemp = `${CHUNKS_FILE}.tmp`
  const vectorsTemp = `${VECTORS_FILE}.tmp`
  const metaTemp = `${META_FILE}.tmp`
  const bm25Temp = `${BM25_FILE}.tmp`
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
        const chunksContent = yield* withReadError(
          fs.readFileString(chunksTemp),
          "read chunks for bm25",
          chunksTemp,
        )
        yield* buildAndStoreBm25(fs, chunksContent, bm25Temp)
      }).pipe(
        Effect.catchAll((err) =>
          storeAbort().pipe(Effect.ignore, Effect.andThen(Effect.fail(err))),
        ),
      )

      yield* withFsError(fs.rename(metaTemp, META_FILE), "commit index meta", META_FILE)
      yield* withFsError(fs.rename(bm25Temp, BM25_FILE), "commit bm25 index", BM25_FILE)
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
    })

  const parseChunkEntries = (
    chunkLines: string[],
    vectors: Float32Array,
    dims: number,
  ): { entries: ChunkEntry[]; malformedLines: number } => {
    const entries: ChunkEntry[] = []
    let malformedLines = 0
    for (let i = 0; i < chunkLines.length; i++) {
      let chunk: Chunk
      try {
        chunk = Schema.decodeUnknownSync(parseJsonChunk)(chunkLines[i])
      } catch {
        malformedLines++
        continue
      }
      const startIdx = i * dims
      entries.push({
        index: i,
        file: chunk.file,
        startLine: chunk.startLine,
        endLine: chunk.endLine,
        text: chunk.text,
        vector: vectors.subarray(startIdx, startIdx + dims),
        contextBefore: chunk.contextBefore,
        contextAfter: chunk.contextAfter,
      })
    }
    return { entries, malformedLines }
  }

  const loadBm25Index = (): Effect.Effect<Bm25Index, StoreError> => loadBm25(fs, BM25_FILE)

  const loadSearchData = (): Effect.Effect<
    SearchData,
    StoreError | NoIndexError | DtypeMismatchError | VectorDecodeError
  > =>
    Effect.gen(function* () {
      const { chunkLines, vectors, dims } = yield* loadIndex()
      const { entries, malformedLines } = parseChunkEntries(chunkLines, vectors, dims)
      const bm25Index = yield* loadBm25Index()
      return { entries, bm25Index, malformedLines }
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
      const bm25 = yield* removeIfExists(BM25_FILE, "bm25 index")

      return {
        deletedChunks: chunks.deleted,
        deletedVectors: vectors.deleted,
        freedBytes: chunks.freed + vectors.freed + meta.freed + bm25.freed,
      }
    })

  return {
    storeBegin,
    storeBatch,
    storeCommit,
    storeAbort,
    loadSearchData,
    getStatus,
    reset,
  } as const
})

export const IndexStoreLive = Layer.provideMerge(Layer.effect(IndexStore, make), ConfigStoreLive)
