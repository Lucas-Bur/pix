import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"

import { IdentifierExtractor } from "../domain/ports.js"
import { IdentifierExtractorLive } from "./identifier-extractor.js"

/** Run an effect that needs the IdentifierExtractor service, supplying the live layer. */
const withExtractor = <A>(
  fn: (svc: typeof IdentifierExtractor.Service) => Effect.Effect<A, never>,
) =>
  Effect.gen(function* () {
    const svc = yield* IdentifierExtractor
    return yield* fn(svc)
  }).pipe(Effect.provide(IdentifierExtractorLive))

describe("IdentifierExtractor service", () => {
  it.effect("extracts a top-level function declaration from a .ts file", () =>
    Effect.gen(function* () {
      const result = yield* withExtractor((svc) =>
        svc.extractIdentifiers("foo.ts", "function foo() {}", 0),
      )
      expect(result).toEqual([{ name: "foo", kind: "function", chunkIndex: 0 }])
    }),
  )

  it.effect("extracts a top-level class declaration from a .ts file", () =>
    Effect.gen(function* () {
      const result = yield* withExtractor((svc) =>
        svc.extractIdentifiers("Foo.ts", "class MyClass {}", 0),
      )
      expect(result).toEqual([{ name: "MyClass", kind: "type", chunkIndex: 0 }])
    }),
  )

  it.effect("captures an arrow function via the surrounding variable_declarator", () =>
    Effect.gen(function* () {
      const result = yield* withExtractor((svc) =>
        svc.extractIdentifiers("a.ts", "const foo = () => 1", 0),
      )
      expect(result).toEqual([{ name: "foo", kind: "value", chunkIndex: 0 }])
    }),
  )

  it.effect("preserves the chunkIndex passed in", () =>
    Effect.gen(function* () {
      const result = yield* withExtractor((svc) =>
        svc.extractIdentifiers("a.ts", "function foo() {}", 42),
      )
      expect(result[0].chunkIndex).toBe(42)
    }),
  )

  it.effect("returns an empty array when no identifiable constructs are present", () =>
    Effect.gen(function* () {
      const result = yield* withExtractor((svc) => svc.extractIdentifiers("a.ts", "42", 0))
      expect(result).toEqual([])
    }),
  )

  it.effect("extracts method definitions inside a class", () =>
    Effect.gen(function* () {
      const result = yield* withExtractor((svc) =>
        svc.extractIdentifiers("a.ts", "class A { greet() {} }", 0),
      )
      expect(result).toEqual([
        { name: "A", kind: "type", chunkIndex: 0 },
        { name: "greet", kind: "function", chunkIndex: 0 },
      ])
    }),
  )

  it.effect("dispatches to the TSX parser for .tsx files", () =>
    Effect.gen(function* () {
      // A simple JSX element. The strict TypeScript parser would treat <div>
      // as a type-argument comparison and fail to produce a clean tree, but
      // the TSX parser handles JSX natively. We just assert the service
      // returns a non-empty list -- if the dispatch is wrong, the TSX
      // content would be parsed by the wrong grammar and most identifiers
      // would be missing or the parse would produce ERROR nodes.
      const result = yield* withExtractor((svc) =>
        svc.extractIdentifiers(
          "Component.tsx",
          'function Card() { return <div className="x" /> }',
          0,
        ),
      )
      expect(result.map((i) => i.name)).toContain("Card")
    }),
  )

  it.effect("extracts Python functions, classes, and type aliases", () =>
    Effect.gen(function* () {
      const result = yield* withExtractor((svc) =>
        svc.extractIdentifiers(
          "example.py",
          "def parse_value():\n    pass\n\nclass ParsedValue:\n    pass\n\ntype Value = int\n",
          3,
        ),
      )
      expect(result).toEqual([
        { name: "parse_value", kind: "function", chunkIndex: 3 },
        { name: "ParsedValue", kind: "type", chunkIndex: 3 },
        { name: "Value", kind: "type", chunkIndex: 3 },
      ])
    }),
  )

  it.effect("extracts Python value bindings without indexing mutation targets", () =>
    Effect.gen(function* () {
      const result = yield* withExtractor((svc) =>
        svc.extractIdentifiers(
          "example.py",
          [
            "value = 1",
            "typed: int = 2",
            "first, second = pair",
            "[head, *tail] = values",
            "self.attribute = 3",
            "items[0] = 4",
          ].join("\n"),
          5,
        ),
      )
      expect(result).toEqual([
        { name: "value", kind: "value", chunkIndex: 5 },
        { name: "typed", kind: "value", chunkIndex: 5 },
        { name: "first", kind: "value", chunkIndex: 5 },
        { name: "second", kind: "value", chunkIndex: 5 },
        { name: "head", kind: "value", chunkIndex: 5 },
        { name: "tail", kind: "value", chunkIndex: 5 },
      ])
    }),
  )

  it.effect("extracts Rust functions, types, and values", () =>
    Effect.gen(function* () {
      const result = yield* withExtractor((svc) =>
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
    }),
  )

  it.effect("returns empty for non-code file extensions", () =>
    Effect.gen(function* () {
      const result = yield* withExtractor((svc) =>
        svc.extractIdentifiers("README.md", "# Markdown heading", 0),
      )
      expect(result).toEqual([])
    }),
  )
})
