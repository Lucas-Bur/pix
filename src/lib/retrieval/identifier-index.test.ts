import { describe, expect, it } from "vite-plus/test"

import { buildIdentifierIndex } from "./identifier-index.js"

describe("buildIdentifierIndex", () => {
  it("returns empty maps for empty input", () => {
    const result = buildIdentifierIndex([])
    expect(result.exact.size).toBe(0)
    expect(result.split.size).toBe(0)
  })

  it("populates the exact map with a single chunk per identifier", () => {
    const result = buildIdentifierIndex([
      { name: "resolveEmbedderConfig", kind: "function", chunkIndex: 3 },
    ])
    expect(result.exact.get("resolveembedderconfig")).toEqual([3])
  })

  it("aggregates chunk indices when the same identifier appears in multiple chunks", () => {
    const result = buildIdentifierIndex([
      { name: "someFunction", kind: "function", chunkIndex: 3 },
      { name: "someFunction", kind: "function", chunkIndex: 7 },
      { name: "someFunction", kind: "function", chunkIndex: 12 },
    ])
    expect(result.exact.get("somefunction")).toEqual([3, 7, 12])
  })

  it("lowercases exact map keys", () => {
    const result = buildIdentifierIndex([
      { name: "DtypeMismatchError", kind: "type", chunkIndex: 5 },
    ])
    expect(result.exact.get("dtypemismatcherror")).toEqual([5])
  })

  it("populates the split map with constituent words from camelCase", () => {
    const result = buildIdentifierIndex([
      { name: "resolveEmbedderConfig", kind: "function", chunkIndex: 3 },
    ])
    expect(result.split.get("resolve")).toEqual([3])
    expect(result.split.get("embedder")).toEqual([3])
    expect(result.split.get("config")).toEqual([3])
  })

  it("handles acronym boundaries in the split map", () => {
    const result = buildIdentifierIndex([{ name: "XMLHttpRequest", kind: "type", chunkIndex: 9 }])
    expect(result.split.get("xml")).toEqual([9])
    expect(result.split.get("http")).toEqual([9])
    expect(result.split.get("request")).toEqual([9])
  })

  it("aggregates split map entries when multiple identifiers share a word", () => {
    const result = buildIdentifierIndex([
      { name: "resolveEmbedderConfig", kind: "function", chunkIndex: 3 },
      { name: "loadConfig", kind: "function", chunkIndex: 7 },
    ])
    expect(result.split.get("config")).toEqual([3, 7])
  })

  it("handles snake_case identifiers in the split map", () => {
    const result = buildIdentifierIndex([{ name: "parse_args", kind: "function", chunkIndex: 0 }])
    expect(result.split.get("parse")).toEqual([0])
    expect(result.split.get("args")).toEqual([0])
  })
})
