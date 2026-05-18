import { describe, expect, it } from "vite-plus/test"

import { rankDense } from "./dense.js"

describe("rankDense", () => {
  it("ranks entries by cosine similarity descending", () => {
    const query = new Float32Array([1, 0, 0])
    const entries = [
      { index: 0, vector: new Float32Array([1, 0, 0]) }, // cos=1.0
      { index: 1, vector: new Float32Array([0, 1, 0]) }, // cos=0.0 (orthogonal, filtered)
      { index: 2, vector: new Float32Array([0.707, 0.707, 0]) }, // cos≈0.707
    ]
    const ranks = rankDense(query, entries)
    expect(ranks).toHaveLength(2)
    expect(ranks[0].chunkIndex).toBe(0)
    expect(ranks[0].score).toBeCloseTo(1, 5)
    expect(ranks[1].chunkIndex).toBe(2)
    expect(ranks[1].score).toBeCloseTo(0.707, 2)
  })

  it("returns empty array for empty entries", () => {
    expect(rankDense(new Float32Array([1, 2, 3]), [])).toEqual([])
  })

  it("filters zero and negative scores", () => {
    const query = new Float32Array([1, 0])
    const entries = [
      { index: 0, vector: new Float32Array([-1, 0]) }, // cos=-1.0
      { index: 1, vector: new Float32Array([0, 1]) }, // cos=0.0
    ]
    expect(rankDense(query, entries)).toEqual([])
  })
})
