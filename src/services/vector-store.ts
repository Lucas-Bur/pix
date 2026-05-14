import { FileSystem } from "@effect/platform"
import { Effect, Layer, Option } from "effect"

import type { Chunk } from "../domain/chunk.js"
import type { Embedding } from "../domain/embedding.js"
import { DiskFullError, NoIndexError, StoreError } from "../domain/errors.js"
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

  const store = (
    chunks: readonly Chunk[],
    embeddings: readonly Embedding[],
  ): Effect.Effect<void, StoreError | DiskFullError> =>
    Effect.gen(function* () {
      const storeDirExists = yield* fs
        .exists(STORE_DIR)
        .pipe(Effect.mapError(toStoreError("check .pix directory")))
      if (!storeDirExists) {
        yield* fs
          .makeDirectory(STORE_DIR, { recursive: true })
          .pipe(Effect.mapError(toStoreError("create .pix directory")))
      }

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
      yield* fs
        .writeFileString(chunksTemp, chunksLines.join("\n"))
        .pipe(Effect.mapError(toStoreError("write chunks", chunksTemp)))
      yield* fs
        .rename(chunksTemp, CHUNKS_FILE)
        .pipe(Effect.mapError(toStoreError("commit chunks", CHUNKS_FILE)))

      const vectorsTemp = `${VECTORS_FILE}.tmp`
      const dims = embeddings[0]?.dims ?? 384
      const totalFloats = embeddings.length * dims
      const vectorsArray = new Float32Array(totalFloats)
      for (let i = 0; i < embeddings.length; i++) {
        vectorsArray.set(embeddings[i].vector, i * dims)
      }
      const buffer = Buffer.from(vectorsArray.buffer)
      yield* fs
        .writeFile(vectorsTemp, buffer)
        .pipe(Effect.mapError(toStoreError("write vectors", vectorsTemp)))
      yield* fs
        .rename(vectorsTemp, VECTORS_FILE)
        .pipe(Effect.mapError(toStoreError("commit vectors", VECTORS_FILE)))
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
      const chunksExists = yield* fs
        .exists(CHUNKS_FILE)
        .pipe(Effect.mapError(toReadError("check chunks file")))
      const vectorsExists = yield* fs
        .exists(VECTORS_FILE)
        .pipe(Effect.mapError(toReadError("check vectors file")))

      if (!chunksExists || !vectorsExists) {
        return yield* new NoIndexError({
          message: "No index found. Run pix index first.",
        })
      }

      const chunksContent = yield* fs
        .readFileString(CHUNKS_FILE)
        .pipe(Effect.mapError(toReadError("read chunks", CHUNKS_FILE)))
      const chunkLines = chunksContent.split("\n").filter((l) => l.trim().length > 0)

      const vectorsBuffer = yield* fs
        .readFile(VECTORS_FILE)
        .pipe(Effect.mapError(toReadError("read vectors", VECTORS_FILE)))
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
      const chunksExists = yield* fs
        .exists(CHUNKS_FILE)
        .pipe(Effect.mapError(toReadError("check chunks file")))
      const vectorsExists = yield* fs
        .exists(VECTORS_FILE)
        .pipe(Effect.mapError(toReadError("check vectors file")))

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

      const content = yield* fs
        .readFileString(CHUNKS_FILE)
        .pipe(Effect.catchAll(() => Effect.succeed("")))
      const lines = content.split("\n").filter((l) => l.trim().length > 0)
      const chunks = lines.length
      const uniqueFiles = countUniqueFiles(lines)
      const files = uniqueFiles.size
      const model = ""
      const totalLines = countTotalLines(lines)

      const vectorsStat = yield* fs
        .stat(VECTORS_FILE)
        .pipe(Effect.catchAll(() => Effect.succeed(null)))
      const byteSize: number = vectorsStat && "size" in vectorsStat ? Number(vectorsStat.size) : 0

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
      let deletedChunks = false
      let deletedVectors = false
      let freedBytes = 0

      const chunksExists = yield* fs
        .exists(CHUNKS_FILE)
        .pipe(Effect.mapError(toStoreError("check chunks file")))
      if (chunksExists) {
        const stat = yield* fs
          .stat(CHUNKS_FILE)
          .pipe(Effect.mapError(toStoreError("stat chunks", CHUNKS_FILE)))
        freedBytes += stat && "size" in stat ? Number(stat.size) : 0
        yield* fs
          .remove(CHUNKS_FILE)
          .pipe(Effect.mapError(toStoreError("delete chunks", CHUNKS_FILE)))
        deletedChunks = true
      }

      const vectorsExists = yield* fs
        .exists(VECTORS_FILE)
        .pipe(Effect.mapError(toStoreError("check vectors file")))
      if (vectorsExists) {
        const stat = yield* fs
          .stat(VECTORS_FILE)
          .pipe(Effect.mapError(toStoreError("stat vectors", VECTORS_FILE)))
        freedBytes += stat && "size" in stat ? Number(stat.size) : 0
        yield* fs
          .remove(VECTORS_FILE)
          .pipe(Effect.mapError(toStoreError("delete vectors", VECTORS_FILE)))
        deletedVectors = true
      }

      return { deletedChunks, deletedVectors, freedBytes }
    })

  return { store, search, getStatus, reset } as const
})

export const VectorStoreLive = Layer.effect(VectorStore, make)
