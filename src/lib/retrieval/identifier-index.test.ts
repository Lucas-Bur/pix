import { describe, expect, it } from "vite-plus/test"

import { buildIdentifierIndex } from "./identifier-index.js"

describe("buildIdentifierIndex", () => {
  it("returns empty maps for empty input", () => {
    const result = buildIdentifierIndex([])
    expect(Object.keys(result.exact).length).toBe(0)
    expect(Object.keys(result.split).length).toBe(0)
  })

  it("populates the exact map with a single chunk per identifier", () => {
    const result = buildIdentifierIndex([
      { name: "resolveEmbedderConfig", kind: "function", chunkIndex: 3 },
    ])
    expect(result.exact["resolveembedderconfig"]).toEqual([3])
  })

  it("aggregates chunk indices when the same identifier appears in multiple chunks", () => {
    const result = buildIdentifierIndex([
      { name: "someFunction", kind: "function", chunkIndex: 3 },
      { name: "someFunction", kind: "function", chunkIndex: 7 },
      { name: "someFunction", kind: "function", chunkIndex: 12 },
    ])
    expect(result.exact["somefunction"]).toEqual([3, 7, 12])
  })

  it("lowercases exact map keys", () => {
    const result = buildIdentifierIndex([
      { name: "DtypeMismatchError", kind: "type", chunkIndex: 5 },
    ])
    expect(result.exact["dtypemismatcherror"]).toEqual([5])
  })

  it("populates the split map with constituent words from camelCase", () => {
    const result = buildIdentifierIndex([
      { name: "resolveEmbedderConfig", kind: "function", chunkIndex: 3 },
    ])
    expect(result.split["resolve"]).toEqual([3])
    expect(result.split["embedder"]).toEqual([3])
    expect(result.split["config"]).toEqual([3])
  })

  it("handles acronym boundaries in the split map", () => {
    const result = buildIdentifierIndex([{ name: "XMLHttpRequest", kind: "type", chunkIndex: 9 }])
    expect(result.split["xml"]).toEqual([9])
    expect(result.split["http"]).toEqual([9])
    expect(result.split["request"]).toEqual([9])
  })

  it("aggregates split map entries when multiple identifiers share a word", () => {
    const result = buildIdentifierIndex([
      { name: "resolveEmbedderConfig", kind: "function", chunkIndex: 3 },
      { name: "loadConfig", kind: "function", chunkIndex: 7 },
    ])
    expect(result.split["config"]).toEqual([3, 7])
  })

  it("handles snake_case identifiers in the split map", () => {
    const result = buildIdentifierIndex([{ name: "parse_args", kind: "function", chunkIndex: 0 }])
    expect(result.split["parse"]).toEqual([0])
    expect(result.split["args"]).toEqual([0])
  })
})
