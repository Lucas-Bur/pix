import { describe, expect, it } from "@effect/vitest"

import { pythonMapKind } from "./python.js"

describe("pythonMapKind", () => {
  it("maps functions, classes, and value bindings", () => {
    expect(pythonMapKind.function_definition).toBe("function")
    expect(pythonMapKind.class_definition).toBe("type")
    expect(pythonMapKind.type_alias_statement).toBe("type")
    expect(pythonMapKind.assignment).toBe("value")
  })

  it("only contains language-agnostic identifier kinds", () => {
    for (const value of Object.values(pythonMapKind)) {
      expect(["function", "type", "value"]).toContain(value)
    }
  })
})
