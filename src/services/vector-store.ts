import { FileSystem } from "@effect/platform"
import { Effect, Layer, Option, Ref, Schema } from "effect"
import ignore from "ignore"

import { ChunkSchema } from "../domain/chunk.js"
import type { Chunk } from "../domain/chunk.js"
import type { Embedding } from "../domain/chunk.js"
import { ChunkValidationError, DiskFullError, NoIndexError, StoreError } from "../domain/errors.js"
import type { IndexStats, SearchOptions, SearchResponse, SearchResult } from "../domain/ports.js"
import { VectorStore } from "../domain/ports.js"
import { isPlatformReason } from "../lib/platform-error.js"

const parseChunkLine = (line: string): Effect.Effect<Option.Option<Chunk>> =>
  Schema.decodeUnknown(parseJsonChunk)(line).pipe(Effect.option)

/** Compute dot-product similarity between a chunk vector and the query embedding. */
const computeDotProduct = (chunkVector: Float32Array, query: Embedding): number => {
  let dot = 0
  for (let j = 0; j < query.dims; j++) {
    dot += chunkVector[j] * query.vector[j]
  }
  return dot
}

const STORE_DIR = ".pix"
const CHUNKS_FILE = `${STORE_DIR}/chunks.jsonl`
const VECTORS_FILE = `${STORE_DIR}/vectors.bin`

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

  const chunksTemp = `${CHUNKS_FILE}.tmp`
  const vectorsTemp = `${VECTORS_FILE}.tmp`
  const seenFiles = yield* Ref.make<Set<string>>(new Set())
  const statsAccumulator = yield* Ref.make<IndexStats>({
    chunks: 0,
    files: 0,
    totalLines: 0,
    byteSize: 0,
  })

  const serializeVectors = (embeddings: readonly Embedding[]): Buffer => {
    const dims = embeddings[0]?.dims ?? 384
    const totalFloats = embeddings.length * dims
    const vectorsArray = new Float32Array(totalFloats)
    for (let i = 0; i < embeddings.length; i++) {
      vectorsArray.set(embeddings[i].vector, i * dims)
    }
    return Buffer.from(vectorsArray.buffer)
  }

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

  /** Check that index files exist; fail with NoIndexError if either is missing. */
  const requireIndex = (): Effect.Effect<void, StoreError | NoIndexError> =>
    Effect.gen(function* () {
      const chunksExists = yield* withReadError(fs.exists(CHUNKS_FILE), "check chunks file")
      const vectorsExists = yield* withReadError(fs.exists(VECTORS_FILE), "check vectors file")
      if (!chunksExists || !vectorsExists) {
        return yield* new NoIndexError({
          message: "No index found. Run pix index first.",
        })
      }
    })

  const toStoreError =
    (operation: string, path?: string) =>
    (cause: unknown): StoreError | DiskFullError => {
      if (isPlatformReason(cause, "BadResource")) {
        return new DiskFullError({
          message: `Disk full during ${operation}`,
          path,
          cause,
        })
      }
      return new StoreError({
        message: `Failed to ${operation}`,
        path,
        cause,
      })
    }

  const toReadError =
    (operation: string, path?: string) =>
    (cause: unknown): StoreError =>
      new StoreError({
        message: `Failed to ${operation}`,
        path,
        cause,
      })

  /** Wrap any fs Effect so failures become StoreError | DiskFullError. */
  const withStoreError = <A>(
    op: Effect.Effect<A, unknown>,
    operation: string,
    path?: string,
  ): Effect.Effect<A, StoreError | DiskFullError> =>
    op.pipe(Effect.mapError(toStoreError(operation, path)))

  /** Wrap any fs Effect so failures become StoreError (read-only). */
  const withReadError = <A>(
    op: Effect.Effect<A, unknown>,
    operation: string,
    path?: string,
  ): Effect.Effect<A, StoreError> => op.pipe(Effect.mapError(toReadError(operation, path)))

  /** Ensure a directory exists, creating it recursively if absent. */
  const ensureDirExists = (
    dir: string,
    description = dir,
  ): Effect.Effect<void, StoreError | DiskFullError> =>
    Effect.gen(function* () {
      const exists = yield* withStoreError(fs.exists(dir), `check ${description}`)
      if (!exists) {
        yield* withStoreError(fs.makeDirectory(dir, { recursive: true }), `create ${description}`)
      }
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
      const exists = yield* withStoreError(fs.exists(file), `check ${description}`)
      if (!exists) return { freed: 0, deleted: false }
      const stat = yield* withStoreError(fs.stat(file), `stat ${description}`, file)
      const freed = stat && "size" in stat ? Number(stat.size) : 0
      yield* withStoreError(fs.remove(file), `delete ${description}`, file)
      return { freed, deleted: true }
    })

  const storeBegin = (): Effect.Effect<void, StoreError | DiskFullError> =>
    Effect.gen(function* () {
      yield* ensureDirExists(STORE_DIR, ".pix directory")
      yield* Ref.set(seenFiles, new Set())
      yield* Ref.set(statsAccumulator, { chunks: 0, files: 0, totalLines: 0, byteSize: 0 })

      const chunksExists = yield* withStoreError(fs.exists(chunksTemp), "check chunks temp")
      if (chunksExists) {
        yield* withStoreError(fs.remove(chunksTemp), "clean stale chunks temp", chunksTemp)
      }
      const vectorsExists = yield* withStoreError(fs.exists(vectorsTemp), "check vectors temp")
      if (vectorsExists) {
        yield* withStoreError(fs.remove(vectorsTemp), "clean stale vectors temp", vectorsTemp)
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
      yield* withStoreError(
        fs.writeFile(chunksTemp, Buffer.from(content), { flag: "a" }),
        "append chunks",
        chunksTemp,
      )

      const buffer = serializeVectors(embeddings)
      yield* withStoreError(
        fs.writeFile(vectorsTemp, buffer, { flag: "a" }),
        "append vectors",
        vectorsTemp,
      )

      const dims = embeddings[0]?.dims ?? 384
      const batchLines = chunks.reduce((sum, c) => sum + (c.endLine - c.startLine + 1), 0)
      const batchBytes = embeddings.length * dims * 4

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
      yield* withStoreError(fs.rename(chunksTemp, CHUNKS_FILE), "commit chunks", CHUNKS_FILE)
      yield* withStoreError(fs.rename(vectorsTemp, VECTORS_FILE), "commit vectors", VECTORS_FILE)
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
    })

  const search = (
    query: Embedding,
    options?: SearchOptions,
  ): Effect.Effect<SearchResponse, StoreError | NoIndexError> =>
    Effect.gen(function* () {
      yield* requireIndex()

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
      const vectors = new Float32Array(
        vectorsBuffer.buffer,
        vectorsBuffer.byteOffset,
        vectorsBuffer.byteLength / Float32Array.BYTES_PER_ELEMENT,
      )

      const ignoreIg = options?.ignorePaths?.length ? ignore().add([...options.ignorePaths]) : null
      const onlyIg = options?.onlyPaths?.length ? ignore().add([...options.onlyPaths]) : null

      const results: SearchResult[] = []
      let malformedLines = 0

      for (let i = 0; i < chunkLines.length; i++) {
        const parsed = yield* parseChunkLine(chunkLines[i])
        if (Option.isNone(parsed)) {
          malformedLines++
          continue
        }

        const chunk = parsed.value
        if (ignoreIg && ignoreIg.ignores(chunk.file)) continue
        if (onlyIg && !onlyIg.ignores(chunk.file)) continue

        const startIdx = i * query.dims
        const chunkVector = vectors.slice(startIdx, startIdx + query.dims)
        const score = computeDotProduct(chunkVector, query)

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

      const validationErrors = buildChunkValidationErrors(malformedLines)

      results.sort((a, b) => b.score - a.score)
      const topK = options?.topK
      if (topK == null) return { results, validationErrors }
      const clamped = Math.max(0, Math.min(Math.floor(topK), results.length))
      return { results: results.slice(0, clamped), validationErrors }
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
      const chunksExists = yield* withReadError(fs.exists(CHUNKS_FILE), "check chunks file")
      const vectorsExists = yield* withReadError(fs.exists(VECTORS_FILE), "check vectors file")

      if (!chunksExists || !vectorsExists) {
        return {
          chunks: 0,
          files: 0,
          model: "",
          lastIndex: 0,
          totalLines: 0,
          byteSize: 0,
          validationErrors: [],
        }
      }

      const content = yield* withReadError(
        fs.readFileString(CHUNKS_FILE),
        "read chunks",
        CHUNKS_FILE,
      )
      const lines = content.split("\n").filter((l) => l.trim().length > 0)
      const { files: uniqueFiles, totalLines, malformedLines } = yield* countChunkStats(lines)
      const chunks = lines.length - malformedLines
      const files = uniqueFiles.size
      const model = ""

      const validationErrors = buildChunkValidationErrors(malformedLines)

      const vectorsStat = yield* withReadError(fs.stat(VECTORS_FILE), "stat vectors", VECTORS_FILE)
      const byteSize: number = "size" in vectorsStat ? Number(vectorsStat.size) : 0

      const lastIndex = Option.map(vectorsStat?.mtime ?? Option.none(), (d) =>
        d instanceof Date ? d.getTime() : 0,
      ).pipe(Option.getOrElse(() => 0))

      return { chunks, files, model, lastIndex, totalLines, byteSize, validationErrors }
    })

  const reset = (): Effect.Effect<
    { deletedChunks: boolean; deletedVectors: boolean; freedBytes: number },
    StoreError | DiskFullError
  > =>
    Effect.gen(function* () {
      const chunks = yield* removeIfExists(CHUNKS_FILE, "chunks")
      const vectors = yield* removeIfExists(VECTORS_FILE, "vectors")

      return {
        deletedChunks: chunks.deleted,
        deletedVectors: vectors.deleted,
        freedBytes: chunks.freed + vectors.freed,
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

export const VectorStoreLive = Layer.effect(VectorStore, make)
