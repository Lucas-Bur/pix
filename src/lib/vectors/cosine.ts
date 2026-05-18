/**
 * Compute cosine similarity between a chunk vector and a query vector. Returns 0 when either norm
 * is 0.
 *
 * Operates on `Float32Array` for SIMD performance — contiguous memory, native ML format. See
 * ADR-0008 for the rationale behind this design choice.
 */
export const computeCosineSimilarity = (
  chunkVector: Float32Array,
  query: Float32Array,
  dims: number,
): number => {
  let dot = 0
  let normA = 0
  let normB = 0
  for (let j = 0; j < dims; j++) {
    dot += chunkVector[j] * query[j]
    normA += chunkVector[j] * chunkVector[j]
    normB += query[j] * query[j]
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB)
  if (denom === 0) return 0
  return dot / denom
}
