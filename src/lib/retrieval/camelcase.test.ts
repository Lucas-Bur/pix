import { describe, expect, it } from "@effect/vitest"

import { rankCamelCase } from "./camelcase.js"

describe("rankCamelCase", () => {
  it("boosts chunks where query constituent words appear", () => {
    // Query "embedder config" splits to ["embedder", "config"]
    const index = {
      exact: {},
      split: {
        embedder: [3, 7],
        config: [3, 12],
      },
    }
    const result = rankCamelCase("embedder config", index)
    // chunk 3 matches both words -> score 2
    // chunk 7 matches "embedder" only -> score 1
    // chunk 12 matches "config" only -> score 1
    expect(result).toEqual([
      { chunkIndex: 3, score: 2 },
      { chunkIndex: 7, score: 1 },
      { chunkIndex: 12, score: 1 },
    ])
  })

  it("splits camelCase query and matches each constituent", () => {
    // Query "DtypeMismatch" splits to ["dtype", "mismatch"]
    const index = {
      exact: {},
      split: {
        dtype: [5],
        mismatch: [5, 9],
      },
    }
    const result = rankCamelCase("DtypeMismatch", index)
    expect(result).toEqual([
      { chunkIndex: 5, score: 2 },
      { chunkIndex: 9, score: 1 },
    ])
  })

  it("returns empty array when no constituent words match", () => {
    const index = { exact: {}, split: { foo: [0] } }
    expect(rankCamelCase("bar baz", index)).toEqual([])
  })

  it("returns empty array for empty query", () => {
    const index = { exact: {}, split: { foo: [0] } }
    expect(rankCamelCase("", index)).toEqual([])
  })

  it("handles a single-word query that matches", () => {
    const index = { exact: {}, split: { foo: [0, 4] } }
    const result = rankCamelCase("foo", index)
    expect(result).toEqual([
      { chunkIndex: 0, score: 1 },
      { chunkIndex: 4, score: 1 },
    ])
  })

  it("ignores query words that have no entries in the index", () => {
    const index = { exact: {}, split: { found: [2] } }
    const result = rankCamelCase("found missing", index)
    expect(result).toEqual([{ chunkIndex: 2, score: 1 }])
  })
})
