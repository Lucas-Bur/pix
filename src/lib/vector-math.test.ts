import { Effect } from "effect"
import { describe, expect, it } from "vite-plus/test"

import type { Embedding } from "../domain/chunk.js"
import { computeCosineSimilarity, serializeVectors } from "./vector-math.js"

const makeEmbedding = (vector: number[], dims?: number): Embedding => ({
  vector: new Float32Array(vector),
  dims: dims ?? vector.length,
  dtype: "fp32",
})

describe("computeCosineSimilarity", () => {
  it("computes cosine similarity of two vectors", () => {
    const chunkVector = new Float32Array([1, 2, 3])
    const query = new Float32Array([4, 5, 6])
    expect(computeCosineSimilarity(chunkVector, query, 3)).toBeCloseTo(0.9746, 3)
  })

  it("returns 0 for orthogonal vectors", () => {
    const chunkVector = new Float32Array([1, 0])
    const query = new Float32Array([0, 1])
    expect(computeCosineSimilarity(chunkVector, query, 2)).toBe(0)
  })

  it("returns 1 for identical vectors", () => {
    const v = new Float32Array([2, 3, 4])
    expect(computeCosineSimilarity(v, v, 3)).toBeCloseTo(1, 5)
  })

  it("returns 0 when both vectors have zero norm", () => {
    const v = new Float32Array([0, 0, 0])
    expect(computeCosineSimilarity(v, v, 3)).toBe(0)
  })
})

describe("serializeVectors", () => {
  it("serializes embeddings to Buffer", () =>
    Effect.gen(function* () {
      const embeddings = [makeEmbedding([1, 2]), makeEmbedding([3, 4])]
      const buffer = yield* serializeVectors(embeddings)
      const floats = new Float32Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / 4)
      expect(Array.from(floats)).toEqual([1, 2, 3, 4])
    }).pipe(Effect.runPromise))

  it("fails for empty embeddings", () =>
    Effect.gen(function* () {
      const result = yield* Effect.either(serializeVectors([]))
      expect(result._tag).toBe("Left")
    }).pipe(Effect.runPromise))

  it("uses correct byte size", () =>
    Effect.gen(function* () {
      const embeddings = [makeEmbedding([1, 2, 3])]
      const buffer = yield* serializeVectors(embeddings)
      expect(buffer.byteLength).toBe(12)
    }).pipe(Effect.runPromise))

  it("fails when embedding dims are inconsistent", () =>
    Effect.gen(function* () {
      const embeddings = [makeEmbedding([1, 2, 3], 3), makeEmbedding([4, 5], 2)]
      const result = yield* Effect.either(serializeVectors(embeddings))
      expect(result._tag).toBe("Left")
    }).pipe(Effect.runPromise))

  it("fails when vector length does not match dims", () =>
    Effect.gen(function* () {
      const embeddings = [makeEmbedding([1, 2, 3], 3), makeEmbedding([4, 5, 6], 2)]
      const result = yield* Effect.either(serializeVectors(embeddings))
      expect(result._tag).toBe("Left")
    }).pipe(Effect.runPromise))
})
