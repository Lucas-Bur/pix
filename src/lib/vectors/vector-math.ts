import { Effect } from "effect"

import type { Embedding } from "../../domain/chunk.js"
import { StoreError } from "../../domain/errors.js"

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

/** Serialize embeddings to a Buffer for writing to vectors.bin. Fails if embeddings array is empty. */
export const serializeVectors = (
  embeddings: readonly Embedding[],
): Effect.Effect<Buffer, StoreError> =>
  Effect.gen(function* () {
    if (embeddings.length === 0) {
      return yield* new StoreError({ message: "Cannot serialize empty embeddings batch" })
    }
    const dims = embeddings[0].dims
    for (let i = 0; i < embeddings.length; i++) {
      const e = embeddings[i]
      if (e.dims !== dims || e.vector.length !== dims) {
        return yield* new StoreError({
          message: `Inconsistent embedding shape at [${i}]: expected dims=${dims}, got dims=${e.dims} length=${e.vector.length}`,
        })
      }
    }
    const totalFloats = embeddings.length * dims
    const vectorsArray = new Float32Array(totalFloats)
    for (let i = 0; i < embeddings.length; i++) {
      vectorsArray.set(embeddings[i].vector, i * dims)
    }
    return Buffer.from(vectorsArray.buffer)
  })
