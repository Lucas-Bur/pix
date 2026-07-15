import { describe, expect, it } from "vite-plus/test"

import { pythonMapKind } from "./python.js"

describe("pythonMapKind", () => {
  it("maps functions and classes", () => {
    expect(pythonMapKind.function_definition).toBe("function")
    expect(pythonMapKind.class_definition).toBe("type")
  })

  it("only contains language-agnostic identifier kinds", () => {
    for (const value of Object.values(pythonMapKind)) {
      expect(["function", "type", "value"]).toContain(value)
    }
  })
})
