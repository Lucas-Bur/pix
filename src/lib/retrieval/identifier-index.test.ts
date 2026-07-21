import { describe, expect, it } from "@effect/vitest"

import { buildIdentifierIndex } from "./identifier-index.js"

describe("identifier index", () => {
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
