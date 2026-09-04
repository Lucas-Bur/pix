import { describe, expect, it } from "@effect/vitest"
import Kotlin from "@tree-sitter-grammars/tree-sitter-kotlin"
import Parser from "tree-sitter"
import Java from "tree-sitter-java"
import Python from "tree-sitter-python"
import TypeScript from "tree-sitter-typescript"

import { extractIdentifiers } from "./identifier-extractor.js"
import { javaMapKind } from "./java.js"
import { kotlinMapKind } from "./kotlin.js"
import { pythonMapKind } from "./python.js"
import { typescriptMapKind } from "./typescript.js"

const setupParser = (): Parser => {
  const parser = new Parser()
  parser.setLanguage(TypeScript.typescript)
  return parser
}

const setupPythonParser = (): Parser => {
  const parser = new Parser()
  parser.setLanguage(Python)
  return parser
}

const setupJavaParser = (): Parser => {
  const parser = new Parser()
  parser.setLanguage(Java)
  return parser
}

const setupKotlinParser = (): Parser => {
  const parser = new Parser()
  parser.setLanguage(Kotlin)
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

  it("extracts identifiers from large sources through the tree-sitter input callback", () => {
    const source = Array.from(
      { length: 1_200 },
      (_, index) => `def function${index}():\n    return ${index}`,
    ).join("\n")
    const result = extractIdentifiers(setupPythonParser(), pythonMapKind, source, 0)

    expect(result).toHaveLength(1_200)
    expect(result[result.length - 1]).toEqual({
      name: "function1199",
      kind: "function",
      chunkIndex: 0,
    })
  })

  it("keeps identifier extraction aligned for large non-ASCII sources", () => {
    const smile = String.fromCodePoint(0x1f600)
    const source = Array.from(
      { length: 1_500 },
      (_, index) => `const value${index} = "${smile}"`,
    ).join("\n")
    const result = extractIdentifiers(setupParser(), typescriptMapKind, source, 0)

    expect(result).toHaveLength(1_500)
    expect(result[result.length - 1]).toEqual({
      name: "value1499",
      kind: "value",
      chunkIndex: 0,
    })
  })

  it("extracts individual bound names from object destructuring", () => {
    const parser = setupParser()
    const result = extractIdentifiers(parser, typescriptMapKind, "const { foo, bar: baz } = obj", 0)
    // `foo` is a shorthand property identifier, `bar: baz` is a pair (value=baz).
    expect(result).toEqual([
      { name: "foo", kind: "value", chunkIndex: 0 },
      { name: "baz", kind: "value", chunkIndex: 0 },
    ])
  })

  it("extracts individual bound names from array destructuring", () => {
    const parser = setupParser()
    const result = extractIdentifiers(parser, typescriptMapKind, "const [first, second] = arr", 0)
    expect(result).toEqual([
      { name: "first", kind: "value", chunkIndex: 0 },
      { name: "second", kind: "value", chunkIndex: 0 },
    ])
  })

  it("extracts a Java class with a field, a constructor, and a method", () => {
    const parser = setupJavaParser()
    const source = "class Foo { private int count; Foo() {} int getCount() { return count; } }"
    const result = extractIdentifiers(parser, javaMapKind, source, 0)
    expect(result).toEqual([
      { name: "Foo", kind: "type", chunkIndex: 0 },
      { name: "count", kind: "value", chunkIndex: 0 },
      { name: "Foo", kind: "function", chunkIndex: 0 },
      { name: "getCount", kind: "function", chunkIndex: 0 },
    ])
  })

  it("extracts Java enum constants", () => {
    const parser = setupJavaParser()
    const result = extractIdentifiers(parser, javaMapKind, "enum Color { RED, GREEN }", 0)
    expect(result).toEqual([
      { name: "Color", kind: "type", chunkIndex: 0 },
      { name: "RED", kind: "value", chunkIndex: 0 },
      { name: "GREEN", kind: "value", chunkIndex: 0 },
    ])
  })

  it("extracts a Kotlin class with a property and a function", () => {
    const parser = setupKotlinParser()
    const source =
      'class Foo {\n  val name: String = "x"\n  fun greet(): String {\n    return name\n  }\n}'
    const result = extractIdentifiers(parser, kotlinMapKind, source, 0)
    expect(result).toEqual([
      { name: "Foo", kind: "type", chunkIndex: 0 },
      { name: "name", kind: "value", chunkIndex: 0 },
      { name: "greet", kind: "function", chunkIndex: 0 },
    ])
  })

  it("collapses Kotlin interfaces and enum classes into class_declaration as type", () => {
    const parser = setupKotlinParser()
    const result = extractIdentifiers(
      parser,
      kotlinMapKind,
      "interface Greeter {\n  fun greet(): String\n}",
      0,
    )
    expect(result).toEqual([
      { name: "Greeter", kind: "type", chunkIndex: 0 },
      { name: "greet", kind: "function", chunkIndex: 0 },
    ])
  })

  it("extracts individual bound names from Kotlin destructuring declarations", () => {
    const parser = setupKotlinParser()
    const result = extractIdentifiers(parser, kotlinMapKind, "val (a, b) = Pair(1, 2)", 0)
    expect(result).toEqual([
      { name: "a", kind: "value", chunkIndex: 0 },
      { name: "b", kind: "value", chunkIndex: 0 },
    ])
  })
})
