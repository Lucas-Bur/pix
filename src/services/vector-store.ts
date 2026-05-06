import { FileSystem } from "@effect/platform"
import type { PlatformError } from "@effect/platform/Error"
import { Effect, Layer, Option } from "effect"

import type { Chunk } from "../domain/chunk.js"
import { VectorStore } from "../domain/ports.js"

const STORE_DIR = ".pix"
const CHUNKS_FILE = `${STORE_DIR}/chunks.jsonl`
const VECTORS_FILE = `${STORE_DIR}/vectors.bin`

/**
 * Reads the first line of chunks.jsonl to get the model name. Returns empty string if the file
 * doesn't exist or is empty.
 */
const readModelFromChunks = (lines: string[]): string => {
  if (lines.length === 0) return ""
  try {
    const first = JSON.parse(lines[0])
    return (first as { model?: string }).model ?? ""
  } catch {
    return ""
  }
}

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

  const store = (
    _chunks: readonly Chunk[],
    _embeddings: readonly { vector: Float32Array; dims: number }[],
  ): Effect.Effect<void, never> =>
    Effect.dieMessage("VectorStore.store not implemented yet — implement alongside pix index")

  const search = (
    _query: { vector: Float32Array; dims: number },
    _topK: number,
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
    never
  > => Effect.dieMessage("VectorStore.search not implemented yet — implement alongside pix query")

  const getStats = (): Effect.Effect<
    {
      chunks: number
      files: number
      model: string
      lastIndex: number
      totalLines: number
      byteSize: number
    },
    PlatformError,
    never
  > =>
    Effect.gen(function* () {
      const chunksExists = yield* fs.exists(CHUNKS_FILE)
      const vectorsExists = yield* fs.exists(VECTORS_FILE)

      // No index exists — return zeros
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

      // Read chunks.jsonl to count chunks and gather metadata
      const content = yield* fs
        .readFileString(CHUNKS_FILE)
        .pipe(Effect.catchAll(() => Effect.succeed("")))
      const lines = content.split("\n").filter((l) => l.trim().length > 0)
      const chunks = lines.length
      const uniqueFiles = countUniqueFiles(lines)
      const files = uniqueFiles.size
      const model = readModelFromChunks(lines)
      const totalLines = countTotalLines(lines)

      // Get vectors.bin size and mtime
      const vectorsStat = yield* fs
        .stat(VECTORS_FILE)
        .pipe(Effect.catchAll(() => Effect.succeed(null)))
      const byteSize: number =
        vectorsStat && "size" in vectorsStat ? (vectorsStat.size as unknown as number) : 0

      // Extract mtime from Option<Date> - Info.mtime is Option<Date>
      const lastIndex = Option.map(vectorsStat?.mtime ?? Option.none(), (d) =>
        d instanceof Date ? d.getTime() : 0,
      ).pipe(Option.getOrElse(() => 0))

      return { chunks, files, model, lastIndex, totalLines, byteSize }
    })

  return { store, search, getStats } as const
})

export const VectorStoreLive = Layer.effect(VectorStore, make)
