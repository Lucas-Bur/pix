import { describe, expect, it } from "vitest"

import { buildSparseQueryTokenIds, poolSparseLogits } from "./encoding.js"

describe("sparse encoding", () => {
  it("max-pools positive logits and removes special tokens", () => {
    const vectors = poolSparseLogits(
      new Float32Array([0, 1, -1, 2, 0, 3, 4, 1]),
      [1, 2, 4],
      [1, 1],
      new Set([3]),
    )

    expect(vectors).toEqual([
      {
        terms: [
          { tokenId: 1, weight: Math.log1p(Math.log1p(3)) },
          { tokenId: 2, weight: Math.log1p(Math.log1p(4)) },
        ],
      },
    ])
  })

  it("builds deterministic unique query token IDs", () => {
    expect(buildSparseQueryTokenIds([101, 8, 7, 7], new Set([101]))).toEqual([7, 8])
  })
})
