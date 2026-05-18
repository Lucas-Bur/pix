import type { RankedChunk } from "../../domain/ports.js"
import { computeCosineSimilarity } from "../vectors/cosine.js"

export const rankDense = (
  queryEmbedding: Float32Array,
  entries: readonly { readonly index: number; readonly vector: Float32Array }[],
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
