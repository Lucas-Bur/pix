import { describe, expect, it } from "vite-plus/test"

import type { Embedding } from "../domain/chunk.js"
import { computeDotProduct, serializeVectors } from "./vector-math.js"

const makeEmbedding = (vector: number[], dims?: number): Embedding => ({
  vector: new Float32Array(vector),
  dims: dims ?? vector.length,
})

describe("computeDotProduct", () => {
  it("computes dot product of two vectors", () => {
    const chunkVector = new Float32Array([1, 2, 3])
    const query = makeEmbedding([4, 5, 6])
    expect(computeDotProduct(chunkVector, query)).toBe(32) // 1*4 + 2*5 + 3*6
  })

  it("returns 0 for orthogonal vectors", () => {
    const chunkVector = new Float32Array([1, 0])
    const query = makeEmbedding([0, 1])
    expect(computeDotProduct(chunkVector, query)).toBe(0)
  })

  it("uses query dims for iteration", () => {
    const chunkVector = new Float32Array([1, 2, 3, 99])
    const query = makeEmbedding([1, 1, 1], 3)
    expect(computeDotProduct(chunkVector, query)).toBe(6) // only first 3 dims
  })
})

describe("serializeVectors", () => {
  it("serializes embeddings to Buffer", () => {
    const embeddings = [makeEmbedding([1, 2]), makeEmbedding([3, 4])]
    const buffer = serializeVectors(embeddings)
    const floats = new Float32Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / 4)
    expect(Array.from(floats)).toEqual([1, 2, 3, 4])
  })

  it("handles empty embeddings", () => {
    const buffer = serializeVectors([])
    expect(buffer.byteLength).toBe(0)
  })

  it("uses correct byte size", () => {
    const embeddings = [makeEmbedding([1, 2, 3])]
    const buffer = serializeVectors(embeddings)
    expect(buffer.byteLength).toBe(12) // 3 floats * 4 bytes
  })
})
