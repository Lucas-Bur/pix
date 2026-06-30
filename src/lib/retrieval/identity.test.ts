import { describe, expect, it } from "vite-plus/test"

import { rankIdentity } from "./identity.js"

describe("rankIdentity", () => {
  it("returns the chunk where the exact identifier name is defined", () => {
    const index = new Map<string, readonly number[]>([["dtypemismatcherror", [3]]])
    const result = rankIdentity("DtypeMismatchError", index)
    expect(result).toEqual([{ chunkIndex: 3, score: 1.0 }])
  })

  it("returns multiple chunks if the identifier appears in several of them", () => {
    const index = new Map<string, readonly number[]>([["somefunction", [3, 7, 12]]])
    const result = rankIdentity("someFunction", index)
    expect(result).toEqual([
      { chunkIndex: 3, score: 1.0 },
      { chunkIndex: 7, score: 1.0 },
      { chunkIndex: 12, score: 1.0 },
    ])
  })

  it("returns empty array when the query does not match any identifier", () => {
    const index = new Map<string, readonly number[]>([["foo", [0]]])
    expect(rankIdentity("bar", index)).toEqual([])
  })

  it("returns empty array for an empty query", () => {
    const index = new Map<string, readonly number[]>([["foo", [0]]])
    expect(rankIdentity("", index)).toEqual([])
  })

  it("is case-insensitive (query and keys are lowercased before lookup)", () => {
    const index = new Map<string, readonly number[]>([["resolveembedderconfig", [3]]])
    expect(rankIdentity("resolveEmbedderConfig", index)).toEqual([{ chunkIndex: 3, score: 1.0 }])
    expect(rankIdentity("RESOLVEEMBEDDERCONFIG", index)).toEqual([{ chunkIndex: 3, score: 1.0 }])
  })
})
