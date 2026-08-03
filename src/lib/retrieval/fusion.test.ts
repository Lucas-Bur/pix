import { describe, expect, it } from "@effect/vitest"

import { fuseRankings } from "./fusion.js"

const weights = {
  identity: 1,
  camelcase: 1,
  bm25: 1,
  dense: 1,
  sparse: 1,
}

const emptyRankings = {
  identity: [],
  camelcase: [],
  bm25: [],
  dense: [],
  sparse: [],
}

describe("fuseRankings", () => {
  it("keeps the compatibility RRF scores and handles missing channels", () => {
    const ranked = fuseRankings(
      "rrf",
      {
        ...emptyRankings,
        identity: [{ chunkIndex: 0, score: 10 }],
        dense: [{ chunkIndex: 1, score: 10 }],
      },
      weights,
    )

    expect(ranked).toHaveLength(2)
    expect(ranked[0]?.score).toBeCloseTo(1 / 61, 10)
    expect(ranked[1]?.score).toBeCloseTo(1 / 61, 10)
    expect(ranked[0]?.chunkIndex).toBe(0)
  })

  it("normalizes relative-score channels independently", () => {
    const first = fuseRankings(
      "relative-score",
      {
        ...emptyRankings,
        bm25: [
          { chunkIndex: 0, score: 10 },
          { chunkIndex: 1, score: 5 },
          { chunkIndex: 2, score: 0 },
        ],
      },
      weights,
    )
    const translated = fuseRankings(
      "relative-score",
      {
        ...emptyRankings,
        bm25: [
          { chunkIndex: 0, score: 110 },
          { chunkIndex: 1, score: 105 },
          { chunkIndex: 2, score: 100 },
        ],
      },
      weights,
    )

    expect(translated.map((entry) => entry.chunkIndex)).toEqual(
      first.map((entry) => entry.chunkIndex),
    )
    expect(translated.map((entry) => entry.score)).toEqual(first.map((entry) => entry.score))
  })

  it("keeps constant and single-result DBSF channels finite", () => {
    const ranked = fuseRankings(
      "dbsf",
      {
        ...emptyRankings,
        sparse: [
          { chunkIndex: 3, score: 7 },
          { chunkIndex: 4, score: 7 },
        ],
      },
      weights,
    )

    expect(ranked).toEqual([
      { chunkIndex: 3, score: 0.5 },
      { chunkIndex: 4, score: 0.5 },
    ])
    expect(ranked.every((entry) => Number.isFinite(entry.score))).toBe(true)
  })

  it("applies candidate depth and deterministic chunk-index tie breaking", () => {
    const ranked = fuseRankings(
      "relative-score",
      {
        ...emptyRankings,
        bm25: [
          { chunkIndex: 2, score: 1 },
          { chunkIndex: 0, score: 1 },
          { chunkIndex: 1, score: 0 },
        ],
      },
      weights,
      2,
    )

    expect(ranked.map((entry) => entry.chunkIndex)).toEqual([0, 2])
  })
})
