import { describe, expect, it } from "@effect/vitest"

import { typescriptMapKind } from "./typescript.js"

describe("typescriptMapKind", () => {
  it("maps function declarations to 'function' kind", () => {
    expect(typescriptMapKind.function_declaration).toBe("function")
    expect(typescriptMapKind.generator_function_declaration).toBe("function")
    expect(typescriptMapKind.method_definition).toBe("function")
  })

  it("maps class/interface/type/enum declarations to 'type' kind", () => {
    expect(typescriptMapKind.class_declaration).toBe("type")
    expect(typescriptMapKind.abstract_class_declaration).toBe("type")
    expect(typescriptMapKind.interface_declaration).toBe("type")
    expect(typescriptMapKind.type_alias_declaration).toBe("type")
    expect(typescriptMapKind.enum_declaration).toBe("type")
  })

  it("maps variable_declarator to 'value' kind (the inner node holding the binding name)", () => {
    expect(typescriptMapKind.variable_declarator).toBe("value")
  })

  it("only contains valid IdentifierKind values", () => {
    const valid: ReadonlyArray<string> = ["function", "type", "value"]
    for (const value of Object.values(typescriptMapKind)) {
      expect(valid).toContain(value)
    }
  })

  it("does not map inner expression nodes (arrow_function, function_expression)", () => {
    // These have no name field — they are captured indirectly via the
    // surrounding variable_declarator when assigned to a const/let/var.
    expect(typescriptMapKind.arrow_function).toBeUndefined()
    expect(typescriptMapKind.function_expression).toBeUndefined()
  })
})
