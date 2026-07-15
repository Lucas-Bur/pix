import { describe, expect, it } from "@effect/vitest"

import { computeCosineSimilarity } from "./cosine.js"

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
