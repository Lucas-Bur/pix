import { describe, expect, it } from "vite-plus/test"

import {
  buildIdentifierIndex,
  deserializeIdentifierIndex,
  serializeIdentifierIndex,
} from "./identifier-index.js"

describe("identifier index serialization", () => {
  it("round-trips an empty index", () => {
    const original = { exact: {}, split: {} }
    const json = serializeIdentifierIndex(original)
    expect(deserializeIdentifierIndex(json)).toEqual(original)
  })

  it("round-trips a populated index", () => {
    const original = buildIdentifierIndex([
      { name: "resolveEmbedderConfig", kind: "function", chunkIndex: 3 },
      { name: "loadConfig", kind: "function", chunkIndex: 7 },
      { name: "DtypeMismatchError", kind: "type", chunkIndex: 5 },
    ])
    const json = serializeIdentifierIndex(original)
    expect(deserializeIdentifierIndex(json)).toEqual(original)
  })

  it("produces valid JSON parseable by JSON.parse", () => {
    const maps = { exact: { foo: [1, 2] }, split: { bar: [3] } }
    const json = serializeIdentifierIndex(maps)
    const parsed = JSON.parse(json)
    expect(parsed).toEqual({ exact: { foo: [1, 2] }, split: { bar: [3] } })
  })

  it("preserves chunk order in the arrays", () => {
    const original = { exact: { f: [3, 7, 12] }, split: {} }
    const json = serializeIdentifierIndex(original)
    expect(deserializeIdentifierIndex(json).exact["f"]).toEqual([3, 7, 12])
  })

  it("preserves lowercase keys", () => {
    const original = buildIdentifierIndex([
      { name: "DtypeMismatchError", kind: "type", chunkIndex: 5 },
    ])
    const json = serializeIdentifierIndex(original)
    expect(deserializeIdentifierIndex(json).exact["dtypemismatcherror"]).toEqual([5])
  })
})
