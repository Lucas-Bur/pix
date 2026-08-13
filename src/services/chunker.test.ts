import crypto from "node:crypto"

import { expect, it } from "@effect/vitest"
import { Effect, Layer } from "effect"

import { memoryFsLayer } from "../../tests/test-utils/memfs.js"
import { Chunker } from "../domain/ports.js"
import { ChunkerLive } from "./chunker.js"
import { ConfigStoreLive } from "./config-store.js"

const fixtureFile = `import { Context, Effect } from "effect"

// Line 3
export interface Test {
  // Line 5
  readonly name: string
  // Line 7
  readonly value: number
}

// Line 10
export class Service extends Context.Service<Service>()("Service", {
  // Line 12
  accessors: true,
  // Line 14
  effect: Effect.gen(function* () {
    // Line 16
    const result = yield* Effect.succeed(42)
    // Line 18
    return { result }
  }),
}) {}

// Line 22
export const makeService = () => {
  // Line 24
  const config = {
    // Line 26
    name: "test-service",
    // Line 28
    version: "1.0.0",
    // Line 30
    description: "A test service for chunking",
  }
  // Line 32
  return config
}

// Line 35
export const createConfig = (name: string) => ({
  // Line 37
  id: crypto.randomUUID(),
  // Line 39
  name,
  // Line 41
  createdAt: new Date().toISOString(),
  // Line 43
})

// Line 45
export const isValid = (value: number) => {
  // Line 47
  if (value < 0) return false
  // Line 49
  if (value > 100) return false
  // Line 51
  return true
}

// Line 54
export const processData = (data: readonly string[]) => {
  // Line 56
  const results = data.map((item) => item.toUpperCase())
  // Line 58
  return results.filter((item) => item.length > 0)
}

// Line 61
export const DEFAULT_TIMEOUT = 5000
// Line 63
export const MAX_RETRIES = 3
// Line 65
export const BATCH_SIZE = 16
// Line 67
export const OVERLAP = 10
// Line 69
export const MIN_CHUNK_SIZE = 20
`

const testLayer = Layer.provideMerge(
  Layer.provideMerge(ChunkerLive, ConfigStoreLive),
  memoryFsLayer({}),
)

const filePath = "src/domain/chunk.ts"

it.effect("Chunker chunks a source file from memory fixture", () =>
  Effect.gen(function* () {
    const chunker = yield* Chunker
    const chunks = yield* chunker.chunkText(fixtureFile, filePath)
    expect(chunks.length).toBeGreaterThan(0)
    for (const chunk of chunks) {
      expect(chunk.file).toBe(filePath)
      expect(chunk.startLine).toBeGreaterThan(0)
      expect(chunk.endLine).toBeGreaterThanOrEqual(chunk.startLine)
      expect(chunk.text.length).toBeGreaterThanOrEqual(20)
      expect(chunk.id.length).toBe(12)
    }
  }).pipe(Effect.provide(testLayer), Effect.scoped),
)

it.effect("Chunker computes fallback chunk-ID from the source range", () =>
  Effect.gen(function* () {
    const chunker = yield* Chunker
    const fallbackFile = "docs/fixture.md"
    const chunks = yield* chunker.chunkText(fixtureFile, fallbackFile)
    expect(chunks.length).toBeGreaterThan(0)
    const expectedId = crypto
      .createHash("sha1")
      .update(`${fallbackFile}:0:${fixtureFile.length}`)
      .digest("hex")
      .slice(0, 12)
    expect(chunks[0].id).toBe(expectedId)
  }).pipe(Effect.provide(testLayer), Effect.scoped),
)

it.effect("Chunker uses index-based IDs", () =>
  Effect.gen(function* () {
    const chunker = yield* Chunker
    const chunks = yield* chunker.chunkText(fixtureFile, filePath)
    for (let i = 0; i < chunks.length; i++) {
      expect(chunks[i].idx).toBe(i)
    }
  }).pipe(Effect.provide(testLayer), Effect.scoped),
)

it.effect("Chunker skips chunks shorter than 20 characters", () =>
  Effect.gen(function* () {
    const chunker = yield* Chunker
    const chunks = yield* chunker.chunkText(fixtureFile, filePath)
    for (const chunk of chunks) {
      expect(chunk.text.length).toBeGreaterThanOrEqual(20)
    }
  }).pipe(Effect.provide(testLayer), Effect.scoped),
)

it.effect("Chunker.chunkText produces chunks from raw text", () =>
  Effect.gen(function* () {
    const chunker = yield* Chunker
    const lines = Array.from({ length: 70 }, (_, i) => `Line ${i + 1} - some content here`)
    const text = lines.join("\n")
    const chunks = yield* chunker.chunkText(text, "docs/test.md")
    expect(chunks.length).toBeGreaterThan(0)
    for (const chunk of chunks) {
      expect(chunk.file).toBe("docs/test.md")
      expect(chunk.startLine).toBeGreaterThan(0)
      expect(chunk.endLine).toBeGreaterThanOrEqual(chunk.startLine)
      expect(chunk.id.length).toBe(12)
    }
  }).pipe(Effect.provide(testLayer), Effect.scoped),
)

it.effect("Chunker.chunkText returns empty array for empty text", () =>
  Effect.gen(function* () {
    const chunker = yield* Chunker
    const chunks = yield* chunker.chunkText("", "src/empty.ts")
    expect(chunks).toEqual([])
  }).pipe(Effect.provide(testLayer), Effect.scoped),
)

it.effect("Chunker emits top-level AST units as structural chunks", () =>
  Effect.gen(function* () {
    const chunker = yield* Chunker
    const source = [
      "function first() {",
      "  return 1",
      "}",
      "",
      "class Second {",
      "  method() {}",
      "}",
    ].join("\n")

    const chunks = yield* chunker.chunkText(source, "src/example.ts")

    expect(chunks).toHaveLength(2)
    expect(chunks.map(({ startLine, endLine }) => [startLine, endLine])).toEqual([
      [1, 3],
      [5, 7],
    ])
  }).pipe(Effect.provide(testLayer), Effect.scoped),
)

it.effect("Chunker embeds leading docs and comments inside declarations", () =>
  Effect.gen(function* () {
    const chunker = yield* Chunker
    const source = [
      "/** Doubles a value. */",
      "function double(value: number) {",
      "  // Multiplication keeps this implementation explicit.",
      "  return value * 2",
      "}",
    ].join("\n")

    const chunks = yield* chunker.chunkText(source, "src/comments.ts")

    expect(chunks).toHaveLength(1)
    expect(chunks[0].startLine).toBe(1)
    expect(chunks[0].endLine).toBe(5)
    expect(chunks[0].text).toBe(source)
  }).pipe(Effect.provide(testLayer), Effect.scoped),
)

it.effect("Chunker keeps a detached top-level comment as its own unit", () =>
  Effect.gen(function* () {
    const chunker = yield* Chunker
    const source = [
      "// Explains the module rather than the declaration.",
      "",
      "function run() {",
      "  return true",
      "}",
    ].join("\n")

    const chunks = yield* chunker.chunkText(source, "src/detached-comment.ts")

    expect(chunks).toHaveLength(2)
    expect(chunks.map(({ text }) => text)).toEqual([
      "// Explains the module rather than the declaration.",
      ["function run() {", "  return true", "}"].join("\n"),
    ])
  }).pipe(Effect.provide(testLayer), Effect.scoped),
)

it.effect("Chunker keeps a trailing top-level comment as its own unit", () =>
  Effect.gen(function* () {
    const chunker = yield* Chunker
    const source = [
      "function run() {",
      "  return true",
      "}",
      "",
      "// Keep this implementation note.",
    ].join("\n")

    const chunks = yield* chunker.chunkText(source, "src/trailing-comment.ts")

    expect(chunks).toHaveLength(2)
    expect(chunks.map(({ text }) => text)).toEqual([
      ["function run() {", "  return true", "}"].join("\n"),
      "// Keep this implementation note.",
    ])
  }).pipe(Effect.provide(testLayer), Effect.scoped),
)

it.effect("Chunker keeps an AST node intact without production token options", () =>
  Effect.gen(function* () {
    const chunker = yield* Chunker
    const body = Array.from({ length: 70 }, (_, index) => `  const value${index} = ${index}`)
    const source = ["function large() {", ...body, "}"].join("\n")

    const chunks = yield* chunker.chunkText(source, "src/large.ts")

    expect(chunks).toHaveLength(1)
    expect(chunks[0].startLine).toBe(1)
    expect(chunks[0].endLine).toBe(72)
    expect(chunks[0].text).toBe(source)
  }).pipe(Effect.provide(testLayer), Effect.scoped),
)

it.effect("Chunker groups adjacent Python and Rust AST nodes", () =>
  Effect.gen(function* () {
    const chunker = yield* Chunker
    const python = yield* chunker.chunkText(
      ["def first():", "    return 1", "", "class Second:", "    pass"].join("\n"),
      "src/example.py",
    )
    const rust = yield* chunker.chunkText(
      ["fn first() {", "    1;", "}", "", "struct Second {", "    value: i32,", "}"].join("\n"),
      "src/example.rs",
    )

    expect(python.map(({ startLine, endLine }) => [startLine, endLine])).toEqual([
      [1, 2],
      [4, 5],
    ])
    expect(rust.map(({ startLine, endLine }) => [startLine, endLine])).toEqual([
      [1, 3],
      [5, 7],
    ])
  }).pipe(Effect.provide(testLayer), Effect.scoped),
)

it.effect("Chunker parses large Python sources through the tree-sitter input callback", () =>
  Effect.gen(function* () {
    const chunker = yield* Chunker
    const source = Array.from(
      { length: 1_200 },
      (_, index) => `def function${index}():\n    return ${index}`,
    ).join("\n")

    const chunks = yield* chunker.chunkText(source, "src/large.py")

    expect(chunks).toHaveLength(1_200)
    expect(chunks.some(({ text }) => text.includes("def function1199"))).toBe(true)
    expect(
      chunks.every((chunk) => source.slice(chunk.startOffset, chunk.endOffset) === chunk.text),
    ).toBe(true)
  }).pipe(Effect.provide(testLayer), Effect.scoped),
)

it.effect("Chunker keeps same-line AST units from duplicating source", () =>
  Effect.gen(function* () {
    const chunker = yield* Chunker
    const source = "function first() {} function second() {}"
    const chunks = yield* chunker.chunkText(source, "src/same-line.ts")

    expect(chunks).toHaveLength(2)
    expect(chunks.map(({ text }) => text)).toEqual(["function first() {}", "function second() {}"])
    expect(
      chunks.every((chunk) => source.slice(chunk.startOffset, chunk.endOffset) === chunk.text),
    ).toBe(true)
  }).pipe(Effect.provide(testLayer), Effect.scoped),
)

it.effect("Chunker keeps consecutive imports as structural units", () =>
  Effect.gen(function* () {
    const chunker = yield* Chunker
    const source = Array.from(
      { length: 65 },
      (_, index) => `import { value${index} } from "./module-${index}.js"`,
    ).join("\n")

    const chunks = yield* chunker.chunkText(source, "src/imports.ts")

    expect(chunks).toHaveLength(65)
    expect(chunks.every((chunk) => chunk.startLine === chunk.endLine)).toBe(true)
  }).pipe(Effect.provide(testLayer), Effect.scoped),
)

it.effect("Chunker returns a structural fallback for malformed TypeScript", () =>
  Effect.gen(function* () {
    const chunker = yield* Chunker
    const source = Array.from({ length: 70 }, (_, index) => `const value${index} =`).join("\n")

    const chunks = yield* chunker.chunkText(source, "src/malformed.ts")

    expect(chunks.map(({ startLine, endLine }) => [startLine, endLine])).toEqual([[1, 70]])
  }).pipe(Effect.provide(testLayer), Effect.scoped),
)

it.effect("Chunker greedily packs AST units under the composite token limit", () =>
  Effect.gen(function* () {
    const chunker = yield* Chunker
    const source = ["const first = 1", "const second = 2", "const third = 3"].join("\n")
    const countTokens = (text: string) =>
      Effect.succeed(text.trim().length === 0 ? 0 : text.trim().split(/\s+/u).length)

    const chunks = yield* chunker.chunkText(source, "src/token-aware.ts", {
      maxTokens: 5,
      overlapLines: 0,
      countTokens,
      onDiagnostic: () => Effect.void,
    })

    expect(chunks).toHaveLength(3)
    expect(chunks.every((chunk) => countTokens(chunk.text).pipe(Effect.runSync) <= 5)).toBe(true)
    expect(
      chunks.every((chunk) => source.slice(chunk.startOffset, chunk.endOffset) === chunk.text),
    ).toBe(true)
  }).pipe(Effect.provide(testLayer), Effect.scoped),
)

it.effect("Chunker keeps call callees attached when splitting oversized AST nodes", () =>
  Effect.gen(function* () {
    const chunker = yield* Chunker
    const source = [
      'describe("suite", () => {',
      ...Array.from({ length: 20 }, (_, index) => `  const value${index} = ${index}`),
      "})",
    ].join("\n")
    const wordCount = (text: string) =>
      text.trim().length === 0 ? 0 : text.trim().split(/\s+/u).length
    const countTokens = (text: string) => Effect.succeed(wordCount(text))

    const chunks = yield* chunker.chunkText(source, "src/oversized-call.ts", {
      maxTokens: 8,
      overlapLines: 0,
      countTokens,
      onDiagnostic: () => Effect.void,
    })

    expect(chunks.some(({ text }) => text.includes("describe("))).toBe(true)
    expect(chunks.some(({ text }) => text.trim() === "describe")).toBe(false)
    expect(chunks.every(({ text }) => wordCount(text) <= 8)).toBe(true)
    expect(chunks.map(({ text }) => text).join("")).toBe(source)
  }).pipe(Effect.provide(testLayer), Effect.scoped),
)

it.effect("Chunker keeps closing delimiters attached when splitting oversized AST nodes", () =>
  Effect.gen(function* () {
    const chunker = yield* Chunker
    const source = [
      "export const testLayer = () => {",
      ...Array.from({ length: 20 }, (_, index) => `  const value${index} = ${index}`),
      "}",
    ].join("\n")
    const wordCount = (text: string) =>
      text.trim().length === 0 ? 0 : text.trim().split(/\s+/u).length
    const countTokens = (text: string) => Effect.succeed(wordCount(text))

    const chunks = yield* chunker.chunkText(source, "src/oversized-function.ts", {
      maxTokens: 8,
      overlapLines: 0,
      countTokens,
      onDiagnostic: () => Effect.void,
    })

    expect(chunks.some(({ text }) => text.trim() === "}")).toBe(false)
    expect(chunks.some(({ text }) => text.includes("}"))).toBe(true)
    expect(chunks.every(({ text }) => wordCount(text) <= 8)).toBe(true)
    expect(chunks.map(({ text }) => text).join("")).toBe(source)
  }).pipe(Effect.provide(testLayer), Effect.scoped),
)

it.effect("Chunker reports parserless fallback and skips unsplittable leaves", () =>
  Effect.gen(function* () {
    const chunker = yield* Chunker
    const diagnostics: unknown[] = []
    const options = {
      maxTokens: 3,
      overlapLines: 0,
      countTokens: (text: string) => Effect.succeed(text.length),
      onDiagnostic: (diagnostic: unknown) =>
        Effect.sync(() => {
          diagnostics.push(diagnostic)
        }),
    }

    const chunks = yield* chunker.chunkText("abcdef", "docs/long-word.md", options)

    expect(chunks).toEqual([])
    expect(diagnostics).toHaveLength(2)
    expect(diagnostics.map((diagnostic) => (diagnostic as { kind: string }).kind)).toEqual([
      "parser-fallback",
      "skipped-chunk",
    ])
  }).pipe(Effect.provide(testLayer), Effect.scoped),
)
