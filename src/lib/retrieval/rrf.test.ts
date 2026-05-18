import { describe, expect, it } from "vite-plus/test"

import { rrfFuse } from "./rrf.js"

describe("rrfFuse", () => {
  it("throws when ranked list count and weight count differ", () => {
    const listA = [{ chunkIndex: 0, score: 1 }]
    expect(() => rrfFuse([listA], [1, 1])).toThrow()
  })

  it("merges two ranked lists by rank position", () => {
    // Chunk 0: rank 1 in list A, rank 2 in list B
    // Chunk 1: rank 2 in list A, rank 1 in list B
    const listA = [
      { chunkIndex: 0, score: 100 },
      { chunkIndex: 1, score: 50 },
    ]
    const listB = [
      { chunkIndex: 1, score: 10 },
      { chunkIndex: 0, score: 5 },
    ]
    const fused = rrfFuse([listA, listB], [1, 1])
    expect(fused).toHaveLength(2)
    // Both chunks appear in both lists at positions 1 and 2, so scores equal
    expect(fused[0].chunkIndex).toBe(0)
    expect(fused[0].score).toBeCloseTo(1 / (60 + 1) + 1 / (60 + 2), 10)
    expect(fused[1].chunkIndex).toBe(1)
  })

  it("applies weights to each path", () => {
    const listA = [{ chunkIndex: 0, score: 1 }]
    const listB = [{ chunkIndex: 0, score: 1 }]
    const fused = rrfFuse([listA, listB], [2, 0.5])
    expect(fused[0].score).toBeCloseTo(2 / (60 + 1) + 0.5 / (60 + 1), 10)
  })

  it("handles empty ranked lists", () => {
    const listA = [{ chunkIndex: 0, score: 1 }]
    const fused = rrfFuse([listA, []], [1, 1])
    expect(fused).toHaveLength(1)
    expect(fused[0].score).toBeCloseTo(1 / (60 + 1), 10)
  })

  it("returns empty for all-empty lists", () => {
    expect(rrfFuse([[], []], [1, 1])).toEqual([])
  })

  it("handles three ranked lists", () => {
    const listA = [{ chunkIndex: 0, score: 1 }]
    const listB = [{ chunkIndex: 0, score: 1 }]
    const listC = [{ chunkIndex: 0, score: 1 }]
    const fused = rrfFuse([listA, listB, listC], [1, 1, 1])
    expect(fused[0].score).toBeCloseTo(3 / (60 + 1), 10)
  })

  it("sorts by RRF score descending", () => {
    const listA = [
      { chunkIndex: 0, score: 100 },
      { chunkIndex: 1, score: 1 },
    ]
    const listB = [
      { chunkIndex: 1, score: 100 },
      { chunkIndex: 0, score: 1 },
    ]
    const fused = rrfFuse([listA, listB], [1, 1])
    // Both appear at rank 1 and 2, so scores are equal — order is insertion-order dependent
    expect(fused).toHaveLength(2)
    expect(fused[0].score).toBeGreaterThanOrEqual(fused[1].score)
  })
})
