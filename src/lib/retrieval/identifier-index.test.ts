import { describe, expect, it } from "@effect/vitest"

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

  it("handles reserved-key identifier names without prototype pollution", () => {
    // Names like `constructor`, `__proto__`, `toString` would otherwise resolve
    // to inherited Object.prototype members instead of an empty bucket -- crashing
    // downstream lookups that expect a number[] value.
    const result = buildIdentifierIndex([
      { name: "constructor", kind: "function", chunkIndex: 1 },
      { name: "__proto__", kind: "type", chunkIndex: 2 },
      { name: "toString", kind: "function", chunkIndex: 3 },
    ])
    expect(result.exact["constructor"]).toEqual([1])
    expect(result.exact["__proto__"]).toEqual([2])
    expect(result.exact["tostring"]).toEqual([3])
  })

  it("deduplicates chunk indices for the same name in the same chunk", () => {
    // Two identifiers in chunk 0 that share the word "config" should still
    // produce a single chunk entry, not [0, 0].
    const result = buildIdentifierIndex([
      { name: "loadConfig", kind: "function", chunkIndex: 0 },
      { name: "saveConfig", kind: "function", chunkIndex: 0 },
    ])
    expect(result.exact["loadconfig"]).toEqual([0])
    expect(result.exact["saveconfig"]).toEqual([0])
    expect(result.split["config"]).toEqual([0])
  })
})
