import crypto from "node:crypto"

import { Effect, Layer } from "effect"
import { expect, test } from "vite-plus/test"

import { memoryFsLayer } from "../../tests/test-utils/memfs.js"
import { Chunker } from "../domain/ports.js"
import { ChunkerLive } from "./chunker.js"
import { ConfigStoreLive } from "./config-store.js"

const fixtureFile = `import { Effect } from "effect"

// Line 3
export interface Test {
  // Line 5
  readonly name: string
  // Line 7
  readonly value: number
}

// Line 10
export class Service extends Effect.Service<Service>()("Service", {
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

const effectTest = <A, E>(name: string, body: () => Effect.Effect<A, E, never>): void => {
  test(name, () => Effect.runPromise(body()))
}

const filePath = "src/domain/chunk.ts"

effectTest("Chunker chunks a source file from memory fixture", () =>
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

effectTest("Chunker computes fallback chunk-ID as sha1(file:startLine).slice(0, 12)", () =>
  Effect.gen(function* () {
    const chunker = yield* Chunker
    const fallbackFile = "docs/fixture.md"
    const chunks = yield* chunker.chunkText(fixtureFile, fallbackFile)
    if (chunks.length === 0) return
    const expectedId = crypto
      .createHash("sha1")
      .update(`${fallbackFile}:1`)
      .digest("hex")
      .slice(0, 12)
    expect(chunks[0].id).toBe(expectedId)
  }).pipe(Effect.provide(testLayer), Effect.scoped),
)

effectTest("Chunker uses index-based IDs", () =>
  Effect.gen(function* () {
    const chunker = yield* Chunker
    const chunks = yield* chunker.chunkText(fixtureFile, filePath)
    for (let i = 0; i < chunks.length; i++) {
      expect(chunks[i].idx).toBe(i)
    }
  }).pipe(Effect.provide(testLayer), Effect.scoped),
)

effectTest("Chunker skips chunks shorter than 20 characters", () =>
  Effect.gen(function* () {
    const chunker = yield* Chunker
    const chunks = yield* chunker.chunkText(fixtureFile, filePath)
    for (const chunk of chunks) {
      expect(chunk.text.length).toBeGreaterThanOrEqual(20)
    }
  }).pipe(Effect.provide(testLayer), Effect.scoped),
)

effectTest("Chunker.chunkText produces chunks from raw text", () =>
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

effectTest("Chunker.chunkText returns empty array for empty text", () =>
  Effect.gen(function* () {
    const chunker = yield* Chunker
    const chunks = yield* chunker.chunkText("", "src/empty.ts")
    expect(chunks).toEqual([])
  }).pipe(Effect.provide(testLayer), Effect.scoped),
)

effectTest("Chunker populates contextBefore and contextAfter around each chunk", () =>
  Effect.gen(function* () {
    const chunker = yield* Chunker
    const lines = Array.from({ length: 80 }, (_, i) => `Line ${i + 1} - some content here`)
    const text = lines.join("\n")
    const chunks = yield* chunker.chunkText(text, "docs/test.md")
    expect(chunks.length).toBeGreaterThanOrEqual(2)

    const second = chunks[1]
    expect(second.contextBefore).not.toBeNull()
    const beforeLines = second.contextBefore!.split("\n")
    expect(beforeLines.length).toBeGreaterThan(0)
    expect(beforeLines[0]).toContain("Line 41")

    const first = chunks[0]
    expect(first.contextAfter).not.toBeNull()
    const afterLines = first.contextAfter!.split("\n")
    expect(afterLines.length).toBeGreaterThan(0)
    expect(afterLines[0]).toContain("Line 61")

    expect(first.file).toBe("docs/test.md")
    expect(first.startLine).toBe(1)
  }).pipe(Effect.provide(testLayer), Effect.scoped),
)

effectTest("Chunker first chunk has no contextBefore, last chunk has no contextAfter", () =>
  Effect.gen(function* () {
    const chunker = yield* Chunker
    const lines = Array.from({ length: 5 }, (_, i) => `Line ${i + 1}`)
    const text = lines.join("\n")
    const chunks = yield* chunker.chunkText(text, "docs/short.md")
    expect(chunks.length).toBeGreaterThanOrEqual(1)

    const first = chunks[0]
    expect(first.contextBefore).toBeNull()

    const last = chunks[chunks.length - 1]
    expect(last.contextAfter).toBeNull()
  }).pipe(Effect.provide(testLayer), Effect.scoped),
)

effectTest("Chunker groups adjacent AST nodes within chunkLines", () =>
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

    expect(chunks).toHaveLength(1)
    expect([chunks[0].startLine, chunks[0].endLine]).toEqual([1, 7])
    expect(chunks[0].text).toBe(source)
  }).pipe(Effect.provide(testLayer), Effect.scoped),
)

effectTest("Chunker embeds leading docs and comments inside declarations", () =>
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
    expect(chunks[0].contextBefore).toBeNull()
  }).pipe(Effect.provide(testLayer), Effect.scoped),
)

effectTest("Chunker keeps an AST node larger than chunkLines intact", () =>
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

effectTest("Chunker groups adjacent Python and Rust AST nodes", () =>
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

    expect(python.map(({ startLine, endLine }) => [startLine, endLine])).toEqual([[1, 5]])
    expect(rust.map(({ startLine, endLine }) => [startLine, endLine])).toEqual([[1, 7]])
  }).pipe(Effect.provide(testLayer), Effect.scoped),
)

effectTest("Chunker groups same-line AST nodes without duplicating source", () =>
  Effect.gen(function* () {
    const chunker = yield* Chunker
    const chunks = yield* chunker.chunkText(
      "function first() {} function second() {}",
      "src/same-line.ts",
    )

    expect(chunks).toHaveLength(1)
    expect(chunks[0].text).toBe("function first() {} function second() {}")
  }).pipe(Effect.provide(testLayer), Effect.scoped),
)

effectTest("Chunker does not emit one-line chunks for consecutive imports", () =>
  Effect.gen(function* () {
    const chunker = yield* Chunker
    const source = Array.from(
      { length: 65 },
      (_, index) => `import { value${index} } from "./module-${index}.js"`,
    ).join("\n")

    const chunks = yield* chunker.chunkText(source, "src/imports.ts")

    expect(chunks).toHaveLength(2)
    expect(chunks.map(({ startLine, endLine }) => endLine - startLine + 1)).toEqual([60, 5])
    expect(chunks.every((chunk) => chunk.startLine < chunk.endLine)).toBe(true)
  }).pipe(Effect.provide(testLayer), Effect.scoped),
)

effectTest("Chunker falls back to line chunks for malformed TypeScript", () =>
  Effect.gen(function* () {
    const chunker = yield* Chunker
    const source = Array.from({ length: 70 }, (_, index) => `const value${index} =`).join("\n")

    const chunks = yield* chunker.chunkText(source, "src/malformed.ts")

    expect(chunks.map(({ startLine, endLine }) => [startLine, endLine])).toEqual([
      [1, 60],
      [51, 70],
    ])
  }).pipe(Effect.provide(testLayer), Effect.scoped),
)
