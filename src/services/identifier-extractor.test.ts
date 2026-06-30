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
  it("extracts a top-level function declaration", async () => {
    const result = await withExtractor((svc) => svc.extractIdentifiers("function foo() {}", 0))
    expect(result).toEqual([{ name: "foo", kind: "function", chunkIndex: 0 }])
  })

  it("extracts a top-level class declaration", async () => {
    const result = await withExtractor((svc) => svc.extractIdentifiers("class MyClass {}", 0))
    expect(result).toEqual([{ name: "MyClass", kind: "type", chunkIndex: 0 }])
  })

  it("captures an arrow function via the surrounding variable_declarator", async () => {
    const result = await withExtractor((svc) => svc.extractIdentifiers("const foo = () => 1", 0))
    expect(result).toEqual([{ name: "foo", kind: "value", chunkIndex: 0 }])
  })

  it("preserves the chunkIndex passed in", async () => {
    const result = await withExtractor((svc) => svc.extractIdentifiers("function foo() {}", 42))
    expect(result[0].chunkIndex).toBe(42)
  })

  it("returns an empty array when no identifiable constructs are present", async () => {
    const result = await withExtractor((svc) => svc.extractIdentifiers("42", 0))
    expect(result).toEqual([])
  })

  it("extracts method definitions inside a class", async () => {
    const result = await withExtractor((svc) => svc.extractIdentifiers("class A { greet() {} }", 0))
    expect(result).toEqual([
      { name: "A", kind: "type", chunkIndex: 0 },
      { name: "greet", kind: "function", chunkIndex: 0 },
    ])
  })
})
