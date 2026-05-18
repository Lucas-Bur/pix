import type { RankedChunk } from "../domain/ports.js"
import { computeCosineSimilarity } from "./vector-math.js"

export interface DenseEntry {
  readonly index: number
  readonly vector: Float32Array
}

export const rankDense = (
  queryEmbedding: Float32Array,
  entries: readonly DenseEntry[],
): RankedChunk[] => {
  const dims = queryEmbedding.length
  const results: RankedChunk[] = []

  for (const entry of entries) {
    const score = computeCosineSimilarity(entry.vector, queryEmbedding, dims)
    if (score > 0) {
      results.push({ chunkIndex: entry.index, score })
    }
  }

  results.sort((a, b) => b.score - a.score)
  return results
}
