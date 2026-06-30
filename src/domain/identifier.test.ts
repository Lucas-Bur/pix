import { describe, expect, it } from "vite-plus/test"

import type { Identifier, IdentifierKind } from "./identifier.js"

describe("Identifier domain type", () => {
  it("represents a function identifier with its chunk location", () => {
    const id: Identifier = {
      name: "resolveEmbedderConfig",
      kind: "function",
      chunkIndex: 3,
    }
    expect(id.name).toBe("resolveEmbedderConfig")
    expect(id.kind).toBe("function")
    expect(id.chunkIndex).toBe(3)
  })

  it("accepts the three language-agnostic kinds: function, type, value", () => {
    const kinds: IdentifierKind[] = ["function", "type", "value"]
    expect(kinds).toHaveLength(3)
  })
})
