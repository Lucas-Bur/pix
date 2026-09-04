import { describe, expect, it } from "@effect/vitest"

import { kotlinMapKind } from "./kotlin.js"

describe("kotlinMapKind", () => {
  it("maps functions", () => {
    expect(kotlinMapKind.function_declaration).toBe("function")
  })

  it("maps classes and objects as types", () => {
    expect(kotlinMapKind.class_declaration).toBe("type")
    expect(kotlinMapKind.object_declaration).toBe("type")
  })

  it("maps properties and enum entries as values", () => {
    expect(kotlinMapKind.property_declaration).toBe("value")
    expect(kotlinMapKind.enum_entry).toBe("value")
  })

  it("only contains language-agnostic identifier kinds", () => {
    for (const value of Object.values(kotlinMapKind)) {
      expect(["function", "type", "value"]).toContain(value)
    }
  })
})
