import type { Embedding } from "../domain/chunk.js"

/** Compute dot-product similarity between a chunk vector and the query embedding. */
export const computeDotProduct = (chunkVector: Float32Array, query: Embedding): number => {
  let dot = 0
  for (let j = 0; j < query.dims; j++) {
    dot += chunkVector[j] * query.vector[j]
  }
  return dot
}

/** Serialize embeddings to a Buffer for writing to vectors.bin. */
export const serializeVectors = (embeddings: readonly Embedding[]): Buffer => {
  const dims = embeddings[0]?.dims ?? 384
  const totalFloats = embeddings.length * dims
  const vectorsArray = new Float32Array(totalFloats)
  for (let i = 0; i < embeddings.length; i++) {
    vectorsArray.set(embeddings[i].vector, i * dims)
  }
  return Buffer.from(vectorsArray.buffer)
}
