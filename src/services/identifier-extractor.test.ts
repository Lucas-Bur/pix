import { Effect } from "effect"
import { describe, expect, it } from "vite-plus/test"

import { IdentifierExtractor } from "../domain/ports.js"
import { IdentifierExtractorLive } from "./identifier-extractor.js"

/** Run an effect that needs the IdentifierExtractor service, supplying the live layer. */
const withExtractor = <A>(
  fn: (svc: typeof IdentifierExtractor.Service) => Effect.Effect<A, never>,
) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const svc = yield* IdentifierExtractor
      return yield* fn(svc)
    }).pipe(Effect.provide(IdentifierExtractorLive)),
  )

describe("IdentifierExtractor service", () => {
  it("extracts a top-level function declaration from a .ts file", async () => {
    const result = await withExtractor((svc) =>
      svc.extractIdentifiers("foo.ts", "function foo() {}", 0),
    )
    expect(result).toEqual([{ name: "foo", kind: "function", chunkIndex: 0 }])
  })

  it("extracts a top-level class declaration from a .ts file", async () => {
    const result = await withExtractor((svc) =>
      svc.extractIdentifiers("Foo.ts", "class MyClass {}", 0),
    )
    expect(result).toEqual([{ name: "MyClass", kind: "type", chunkIndex: 0 }])
  })

  it("captures an arrow function via the surrounding variable_declarator", async () => {
    const result = await withExtractor((svc) =>
      svc.extractIdentifiers("a.ts", "const foo = () => 1", 0),
    )
    expect(result).toEqual([{ name: "foo", kind: "value", chunkIndex: 0 }])
  })

  it("preserves the chunkIndex passed in", async () => {
    const result = await withExtractor((svc) =>
      svc.extractIdentifiers("a.ts", "function foo() {}", 42),
    )
    expect(result[0].chunkIndex).toBe(42)
  })

  it("returns an empty array when no identifiable constructs are present", async () => {
    const result = await withExtractor((svc) => svc.extractIdentifiers("a.ts", "42", 0))
    expect(result).toEqual([])
  })

  it("extracts method definitions inside a class", async () => {
    const result = await withExtractor((svc) =>
      svc.extractIdentifiers("a.ts", "class A { greet() {} }", 0),
    )
    expect(result).toEqual([
      { name: "A", kind: "type", chunkIndex: 0 },
      { name: "greet", kind: "function", chunkIndex: 0 },
    ])
  })

  it("dispatches to the TSX parser for .tsx files", async () => {
    // A simple JSX element. The strict TypeScript parser would treat <div>
    // as a type-argument comparison and fail to produce a clean tree, but
    // the TSX parser handles JSX natively. We just assert the service
    // returns a non-empty list -- if the dispatch is wrong, the TSX
    // content would be parsed by the wrong grammar and most identifiers
    // would be missing or the parse would produce ERROR nodes.
    const result = await withExtractor((svc) =>
      svc.extractIdentifiers(
        "Component.tsx",
        'function Card() { return <div className="x" /> }',
        0,
      ),
    )
    expect(result.map((i) => i.name)).toContain("Card")
  })

  it("extracts Python functions and classes", async () => {
    const result = await withExtractor((svc) =>
      svc.extractIdentifiers(
        "example.py",
        "def parse_value():\n    pass\n\nclass ParsedValue:\n    pass\n",
        3,
      ),
    )
    expect(result).toEqual([
      { name: "parse_value", kind: "function", chunkIndex: 3 },
      { name: "ParsedValue", kind: "type", chunkIndex: 3 },
    ])
  })

  it("extracts Rust functions, types, and values", async () => {
    const result = await withExtractor((svc) =>
      svc.extractIdentifiers(
        "example.rs",
        "fn parse_value() {}\nstruct ParsedValue;\nconst LIMIT: usize = 10;",
        4,
      ),
    )
    expect(result).toEqual([
      { name: "parse_value", kind: "function", chunkIndex: 4 },
      { name: "ParsedValue", kind: "type", chunkIndex: 4 },
      { name: "LIMIT", kind: "value", chunkIndex: 4 },
    ])
  })

  it("returns empty for non-code file extensions", async () => {
    const result = await withExtractor((svc) =>
      svc.extractIdentifiers("README.md", "# Markdown heading", 0),
    )
    expect(result).toEqual([])
  })
})
