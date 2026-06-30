import Parser from "tree-sitter"
import TypeScript from "tree-sitter-typescript"
import { describe, expect, it } from "vite-plus/test"

import { extractIdentifiers } from "./identifier-extractor.js"
import { typescriptMapKind } from "./typescript.js"

const setupParser = (): Parser => {
  const parser = new Parser()
  parser.setLanguage(TypeScript.typescript)
  return parser
}

describe("extractIdentifiers", () => {
  it("extracts a top-level function declaration", () => {
    const parser = setupParser()
    const result = extractIdentifiers(parser, typescriptMapKind, "function foo() {}", 0)
    expect(result).toEqual([{ name: "foo", kind: "function", chunkIndex: 0 }])
  })

  it("extracts a top-level class declaration", () => {
    const parser = setupParser()
    const result = extractIdentifiers(parser, typescriptMapKind, "class MyClass {}", 0)
    expect(result).toEqual([{ name: "MyClass", kind: "type", chunkIndex: 0 }])
  })

  it("captures an arrow function via the surrounding variable_declarator", () => {
    const parser = setupParser()
    const result = extractIdentifiers(parser, typescriptMapKind, "const foo = () => 1", 0)
    // `foo` is the name of the binding; the arrow function itself is anonymous
    // and is intentionally not in the mapKind table.
    expect(result).toEqual([{ name: "foo", kind: "value", chunkIndex: 0 }])
  })

  it("recurses into nested function declarations", () => {
    const parser = setupParser()
    const result = extractIdentifiers(
      parser,
      typescriptMapKind,
      "function outer() { function inner() {} }",
      0,
    )
    expect(result).toEqual([
      { name: "outer", kind: "function", chunkIndex: 0 },
      { name: "inner", kind: "function", chunkIndex: 0 },
    ])
  })

  it("preserves the chunkIndex passed in", () => {
    const parser = setupParser()
    const result = extractIdentifiers(parser, typescriptMapKind, "function foo() {}", 42)
    expect(result[0].chunkIndex).toBe(42)
  })

  it("returns an empty array when no identifiable constructs are present", () => {
    const parser = setupParser()
    const result = extractIdentifiers(parser, typescriptMapKind, "42", 0)
    expect(result).toEqual([])
  })

  it("extracts method definitions inside a class", () => {
    const parser = setupParser()
    const result = extractIdentifiers(parser, typescriptMapKind, "class A { greet() {} }", 0)
    expect(result).toEqual([
      { name: "A", kind: "type", chunkIndex: 0 },
      { name: "greet", kind: "function", chunkIndex: 0 },
    ])
  })
})
