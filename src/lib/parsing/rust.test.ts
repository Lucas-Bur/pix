import { describe, expect, it } from "vite-plus/test"

import { rustMapKind } from "./rust.js"

describe("rustMapKind", () => {
  it("maps functions", () => {
    expect(rustMapKind.function_item).toBe("function")
    expect(rustMapKind.function_signature_item).toBe("function")
  })

  it("maps nominal and aliased types", () => {
    expect(rustMapKind.struct_item).toBe("type")
    expect(rustMapKind.enum_item).toBe("type")
    expect(rustMapKind.union_item).toBe("type")
    expect(rustMapKind.trait_item).toBe("type")
    expect(rustMapKind.type_item).toBe("type")
  })

  it("maps constants and statics as values", () => {
    expect(rustMapKind.const_item).toBe("value")
    expect(rustMapKind.static_item).toBe("value")
  })

  it("only contains language-agnostic identifier kinds", () => {
    for (const value of Object.values(rustMapKind)) {
      expect(["function", "type", "value"]).toContain(value)
    }
  })
})
