import { FileSystem } from "@effect/platform"
import { Effect, Layer, Option, Ref } from "effect"
import ignore from "ignore"

import type { Chunk } from "../domain/chunk.js"
import type { Embedding } from "../domain/embedding.js"
import { DiskFullError, NoIndexError, StoreError } from "../domain/errors.js"
import type { IndexStats, SearchOptions, SearchResult } from "../domain/ports.js"
import { VectorStore } from "../domain/ports.js"
import { isPlatformReason } from "../lib/platform-error.js"

interface ParsedChunkLine {
  file: string
  startLine: number
  endLine: number
  text: string
  contextBefore: string | null
  contextAfter: string | null
}

/**
 * Parse a single JSON line from chunks.jsonl and normalize context fields (old indexes may lack
 * them).
 */
const parseChunkLine = (line: string): ParsedChunkLine => {
  const raw = JSON.parse(line) as {
    file: unknown
    startLine: unknown
    endLine: unknown
    text: unknown
    contextBefore: unknown
    contextAfter: unknown
  }
  return {
    file: typeof raw.file === "string" ? raw.file : "",
    startLine: typeof raw.startLine === "number" ? raw.startLine : 0,
    endLine: typeof raw.endLine === "number" ? raw.endLine : 0,
    text: typeof raw.text === "string" ? raw.text : "",
    contextBefore: typeof raw.contextBefore === "string" ? raw.contextBefore : null,
    contextAfter: typeof raw.contextAfter === "string" ? raw.contextAfter : null,
  }
}

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

/**
 * Serialize a Chunk to a JSON object for storage in chunks.jsonl. Always includes context fields
 * for schema consistency.
 */
const serializeChunk = (c: Chunk): Record<string, unknown> => ({
  id: c.id,
  idx: c.idx,
  file: c.file,
  startLine: c.startLine,
  endLine: c.endLine,
  text: c.text,
  contextBefore: c.contextBefore,
  contextAfter: c.contextAfter,
})

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
      const content = chunks.map((c) => JSON.stringify(serializeChunk(c))).join("\n") + "\n"
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

  const store = (
    chunks: readonly Chunk[],
    embeddings: readonly Embedding[],
  ): Effect.Effect<void, StoreError | DiskFullError> =>
    Effect.gen(function* () {
      yield* ensureDirExists(STORE_DIR, ".pix directory")

      const chunksTemp = `${CHUNKS_FILE}.tmp`
      const chunksJson = chunks.map((c) => JSON.stringify(serializeChunk(c))).join("\n")
      yield* withStoreError(fs.writeFileString(chunksTemp, chunksJson), "write chunks", chunksTemp)
      yield* withStoreError(fs.rename(chunksTemp, CHUNKS_FILE), "commit chunks", CHUNKS_FILE)

      const vectorsTemp = `${VECTORS_FILE}.tmp`
      const buffer = serializeVectors(embeddings)
      yield* withStoreError(fs.writeFile(vectorsTemp, buffer), "write vectors", vectorsTemp)
      yield* withStoreError(fs.rename(vectorsTemp, VECTORS_FILE), "commit vectors", VECTORS_FILE)
    })

  const search = (
    query: Embedding,
    options?: SearchOptions,
  ): Effect.Effect<readonly SearchResult[], StoreError | NoIndexError> =>
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
      const vectors = new Float32Array(
        vectorsBuffer.buffer,
        vectorsBuffer.byteOffset,
        vectorsBuffer.byteLength / Float32Array.BYTES_PER_ELEMENT,
      )

      const ignoreIg = options?.ignorePaths?.length ? ignore().add([...options.ignorePaths]) : null
      const onlyIg = options?.onlyPaths?.length ? ignore().add([...options.onlyPaths]) : null

      const results: SearchResult[] = []

      for (let i = 0; i < chunkLines.length; i++) {
        try {
          const chunk = parseChunkLine(chunkLines[i])

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
        } catch {
          // Skip malformed lines
        }
      }

      results.sort((a, b) => b.score - a.score)
      const topK = options?.topK
      if (topK == null) return results
      const clamped = Math.max(0, Math.min(Math.floor(topK), results.length))
      return results.slice(0, clamped)
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
