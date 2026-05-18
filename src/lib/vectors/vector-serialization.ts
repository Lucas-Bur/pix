import { Effect } from "effect"

import type { Embedding } from "../../domain/chunk.js"
import { StoreError } from "../../domain/errors.js"

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
