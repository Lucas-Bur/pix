import { FileSystem } from "@effect/platform"
import { Effect, Layer, Option, Ref } from "effect"

import type { Chunk } from "../domain/chunk.js"
import type { Embedding } from "../domain/embedding.js"
import { DiskFullError, NoIndexError, StoreError } from "../domain/errors.js"
import type { IndexStats } from "../domain/ports.js"
import { VectorStore } from "../domain/ports.js"

const STORE_DIR = ".pix"
const CHUNKS_FILE = `${STORE_DIR}/chunks.jsonl`
const VECTORS_FILE = `${STORE_DIR}/vectors.bin`

const isPlatformReason = (cause: unknown, reason: string): boolean =>
  typeof cause === "object" &&
  cause !== null &&
  "reason" in cause &&
  String((cause as { reason: unknown }).reason) === reason

/**
 * FileSystem adapter for VectorStore port. Reads from chunks.jsonl and vectors.bin to provide index
 * statistics.
 */
const make = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem

  const chunksTemp = `${CHUNKS_FILE}.tmp`
  const vectorsTemp = `${VECTORS_FILE}.tmp`

  const chunksHandle = yield* Ref.make<Option.Option<unknown>>(Option.none())
  const vectorsHandle = yield* Ref.make<Option.Option<unknown>>(Option.none())
  const statsAccumulator = yield* Ref.make<IndexStats>({
    chunks: 0,
    files: 0,
    totalLines: 0,
    byteSize: 0,
  })

  /**
   * Count total lines across all chunks in chunks.jsonl. Each line is a JSON object; the 'text'
   * field contains the source code.
   */
  const countTotalLines = (lines: string[]): number =>
    lines.reduce((sum, line) => {
      try {
        const chunk = JSON.parse(line) as { text: string }
        return sum + chunk.text.split("\n").length
      } catch {
        return sum
      }
    }, 0)

  /** Count unique files across all chunks in chunks.jsonl. */
  const countUniqueFiles = (lines: string[]): Set<string> => {
    const files = new Set<string>()
    for (const line of lines) {
      try {
        const chunk = JSON.parse(line) as { file: string }
        files.add(chunk.file)
      } catch {
        // Skip malformed lines
      }
    }
    return files
  }

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
      yield* Ref.set(chunksHandle, Option.none())
      yield* Ref.set(vectorsHandle, Option.none())
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
      const chunksLines = chunks.map((c) =>
        JSON.stringify({
          id: c.id,
          idx: c.idx,
          file: c.file,
          startLine: c.startLine,
          endLine: c.endLine,
          text: c.text,
        }),
      )
      const content = chunksLines.join("\n") + "\n"
      yield* withStoreError(
        fs.writeFile(chunksTemp, Buffer.from(content), { flag: "a" }),
        "append chunks",
        chunksTemp,
      )

      const dims = embeddings[0]?.dims ?? 384
      const totalFloats = embeddings.length * dims
      const vectorsArray = new Float32Array(totalFloats)
      for (let i = 0; i < embeddings.length; i++) {
        vectorsArray.set(embeddings[i].vector, i * dims)
      }
      const buffer = Buffer.from(vectorsArray.buffer)
      yield* withStoreError(
        fs.writeFile(vectorsTemp, buffer, { flag: "a" }),
        "append vectors",
        vectorsTemp,
      )

      const uniqueFiles = new Set(chunks.map((c) => c.file))
      const batchLines = chunks.reduce((sum, c) => sum + (c.endLine - c.startLine + 1), 0)
      const batchBytes = embeddings.length * dims * 4

      yield* Ref.update(statsAccumulator, (prev) => ({
        chunks: prev.chunks + chunks.length,
        files: prev.files + uniqueFiles.size,
        totalLines: prev.totalLines + batchLines,
        byteSize: prev.byteSize + batchBytes,
      }))
    })

  const storeCommit = (): Effect.Effect<IndexStats, StoreError | DiskFullError> =>
    Effect.gen(function* () {
      yield* withStoreError(fs.rename(chunksTemp, CHUNKS_FILE), "commit chunks", CHUNKS_FILE)
      yield* withStoreError(fs.rename(vectorsTemp, VECTORS_FILE), "commit vectors", VECTORS_FILE)
      yield* Ref.set(chunksHandle, Option.none())
      yield* Ref.set(vectorsHandle, Option.none())
      return yield* Ref.get(statsAccumulator)
    })

  const storeAbort = (): Effect.Effect<void, StoreError> =>
    Effect.gen(function* () {
      yield* Ref.set(chunksHandle, Option.none())
      yield* Ref.set(vectorsHandle, Option.none())
      const chunksExists = yield* withReadError(fs.exists(chunksTemp), "check chunks temp")
      if (chunksExists) {
        yield* withReadError(fs.remove(chunksTemp), "abort chunks temp", chunksTemp)
      }
      const vectorsExists = yield* withReadError(fs.exists(vectorsTemp), "check vectors temp")
      if (vectorsExists) {
        yield* withReadError(fs.remove(vectorsTemp), "abort vectors temp", vectorsTemp)
      }
    })

  const store = (
    chunks: readonly Chunk[],
    embeddings: readonly Embedding[],
  ): Effect.Effect<void, StoreError | DiskFullError> =>
    Effect.gen(function* () {
      yield* ensureDirExists(STORE_DIR, ".pix directory")

      const chunksTemp = `${CHUNKS_FILE}.tmp`
      const chunksLines = chunks.map((c) =>
        JSON.stringify({
          id: c.id,
          idx: c.idx,
          file: c.file,
          startLine: c.startLine,
          endLine: c.endLine,
          text: c.text,
        }),
      )
      yield* withStoreError(
        fs.writeFileString(chunksTemp, chunksLines.join("\n")),
        "write chunks",
        chunksTemp,
      )
      yield* withStoreError(fs.rename(chunksTemp, CHUNKS_FILE), "commit chunks", CHUNKS_FILE)

      const vectorsTemp = `${VECTORS_FILE}.tmp`
      const dims = embeddings[0]?.dims ?? 384
      const totalFloats = embeddings.length * dims
      const vectorsArray = new Float32Array(totalFloats)
      for (let i = 0; i < embeddings.length; i++) {
        vectorsArray.set(embeddings[i].vector, i * dims)
      }
      const buffer = Buffer.from(vectorsArray.buffer)
      yield* withStoreError(fs.writeFile(vectorsTemp, buffer), "write vectors", vectorsTemp)
      yield* withStoreError(fs.rename(vectorsTemp, VECTORS_FILE), "commit vectors", VECTORS_FILE)
    })

  const search = (
    query: Embedding,
    topK: number,
  ): Effect.Effect<
    readonly {
      score: number
      file: string
      startLine: number
      endLine: number
      text: string
      contextBefore?: string
      contextAfter?: string
    }[],
    StoreError | NoIndexError
  > =>
    Effect.gen(function* () {
      const chunksExists = yield* withReadError(fs.exists(CHUNKS_FILE), "check chunks file")
      const vectorsExists = yield* withReadError(fs.exists(VECTORS_FILE), "check vectors file")

      if (!chunksExists || !vectorsExists) {
        return yield* new NoIndexError({
          message: "No index found. Run pix index first.",
        })
      }

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
      const vectors = new Float32Array(vectorsBuffer.buffer as ArrayBuffer)

      const results: {
        score: number
        file: string
        startLine: number
        endLine: number
        text: string
        contextBefore?: string
        contextAfter?: string
      }[] = []

      for (let i = 0; i < chunkLines.length; i++) {
        try {
          const chunk = JSON.parse(chunkLines[i]) as {
            file: string
            startLine: number
            endLine: number
            text: string
            contextBefore?: string
            contextAfter?: string
          }

          const startIdx = i * query.dims
          const chunkVector = vectors.slice(startIdx, startIdx + query.dims)

          let dotProduct = 0
          for (let j = 0; j < query.dims; j++) {
            dotProduct += chunkVector[j] * query.vector[j]
          }

          results.push({
            score: dotProduct,
            file: chunk.file,
            startLine: chunk.startLine,
            endLine: chunk.endLine,
            text: chunk.text,
            contextBefore: chunk.contextBefore,
            contextAfter: chunk.contextAfter,
          })
        } catch {
          // Skip malformed lines
        }
      }

      results.sort((a, b) => b.score - a.score)
      return results.slice(0, topK)
    })

  const getStatus = (): Effect.Effect<
    {
      chunks: number
      files: number
      model: string
      lastIndex: number
      totalLines: number
      byteSize: number
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
        }
      }

      const content = yield* withReadError(
        fs.readFileString(CHUNKS_FILE),
        "read chunks",
        CHUNKS_FILE,
      )
      const lines = content.split("\n").filter((l) => l.trim().length > 0)
      const chunks = lines.length
      const uniqueFiles = countUniqueFiles(lines)
      const files = uniqueFiles.size
      const model = ""
      const totalLines = countTotalLines(lines)

      const vectorsStat = yield* withReadError(fs.stat(VECTORS_FILE), "stat vectors", VECTORS_FILE)
      const byteSize: number = "size" in vectorsStat ? Number(vectorsStat.size) : 0

      const lastIndex = Option.map(vectorsStat?.mtime ?? Option.none(), (d) =>
        d instanceof Date ? d.getTime() : 0,
      ).pipe(Option.getOrElse(() => 0))

      return { chunks, files, model, lastIndex, totalLines, byteSize }
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
    store,
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
