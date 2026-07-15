import { describe, expect, it } from "@effect/vitest"

import { rankIdentity } from "./identity.js"

describe("rankIdentity", () => {
  it("returns the chunk where the exact identifier name is defined", () => {
    const index = { exact: { dtypemismatcherror: [3] }, split: {} }
    const result = rankIdentity("DtypeMismatchError", index)
    expect(result).toEqual([{ chunkIndex: 3, score: 1.0 }])
  })

  it("returns multiple chunks if the identifier appears in several of them", () => {
    const index = { exact: { somefunction: [3, 7, 12] }, split: {} }
    const result = rankIdentity("someFunction", index)
    expect(result).toEqual([
      { chunkIndex: 3, score: 1.0 },
      { chunkIndex: 7, score: 1.0 },
      { chunkIndex: 12, score: 1.0 },
    ])
  })

  it("returns empty array when the query does not match any identifier", () => {
    const index = { exact: { foo: [0] }, split: {} }
    expect(rankIdentity("bar", index)).toEqual([])
  })

  it("returns empty array for an empty query", () => {
    const index = { exact: { foo: [0] }, split: {} }
    expect(rankIdentity("", index)).toEqual([])
  })

  it("is case-insensitive (query and keys are lowercased before lookup)", () => {
    const index = { exact: { resolveembedderconfig: [3] }, split: {} }
    expect(rankIdentity("resolveEmbedderConfig", index)).toEqual([{ chunkIndex: 3, score: 1.0 }])
    expect(rankIdentity("RESOLVEEMBEDDERCONFIG", index)).toEqual([{ chunkIndex: 3, score: 1.0 }])
  })
})
