import { describe, expect, it } from "@effect/vitest"

import { javaMapKind } from "./java.js"

describe("javaMapKind", () => {
  it("maps functions", () => {
    expect(javaMapKind.method_declaration).toBe("function")
    expect(javaMapKind.constructor_declaration).toBe("function")
  })

  it("maps nominal types", () => {
    expect(javaMapKind.class_declaration).toBe("type")
    expect(javaMapKind.interface_declaration).toBe("type")
    expect(javaMapKind.enum_declaration).toBe("type")
    expect(javaMapKind.record_declaration).toBe("type")
    expect(javaMapKind.annotation_type_declaration).toBe("type")
  })

  it("maps fields, locals, and enum constants as values", () => {
    expect(javaMapKind.variable_declarator).toBe("value")
    expect(javaMapKind.enum_constant).toBe("value")
  })

  it("only contains language-agnostic identifier kinds", () => {
    for (const value of Object.values(javaMapKind)) {
      expect(["function", "type", "value"]).toContain(value)
    }
  })
})
