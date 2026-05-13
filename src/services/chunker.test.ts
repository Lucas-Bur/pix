import crypto from "node:crypto"

import { Effect, Layer } from "effect"
import { expect, test } from "vite-plus/test"

import { memoryFsLayer } from "../../tests/test-utils/memfs.js"
import { Chunker, ChunkerLive } from "./chunker.ts"
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

const fixtures = { "src/domain/chunk.ts": fixtureFile }

const testLayer = Layer.provideMerge(
  Layer.provideMerge(ChunkerLive, ConfigStoreLive),
  memoryFsLayer(fixtures),
)

test("Chunker returns empty array for nonexistent file", () =>
  Effect.gen(function* () {
    const chunker = yield* Chunker
    const chunks = yield* chunker.chunkFile("nonexistent/file/that/does/not/exist.ts")
    expect(chunks).toEqual([])
  }).pipe(Effect.provide(testLayer), Effect.scoped))

test("Chunker chunks a source file from memory fixture", () =>
  Effect.gen(function* () {
    const chunker = yield* Chunker
    const chunks = yield* chunker.chunkFile("src/domain/chunk.ts")
    expect(chunks.length).toBeGreaterThan(0)
    for (const chunk of chunks) {
      expect(chunk.file).toBe("src/domain/chunk.ts")
      expect(chunk.startLine).toBeGreaterThan(0)
      expect(chunk.endLine).toBeGreaterThanOrEqual(chunk.startLine)
      expect(chunk.text.length).toBeGreaterThanOrEqual(20)
      expect(chunk.id.length).toBe(12)
    }
  }).pipe(Effect.provide(testLayer), Effect.scoped))

test("Chunker computes chunk-ID as sha1(file:startLine).slice(0, 12)", () =>
  Effect.gen(function* () {
    const chunker = yield* Chunker
    const chunks = yield* chunker.chunkFile("src/domain/chunk.ts")
    if (chunks.length === 0) return
    const expectedId = crypto
      .createHash("sha1")
      .update("src/domain/chunk.ts:1")
      .digest("hex")
      .slice(0, 12)
    expect(chunks[0].id).toBe(expectedId)
  }).pipe(Effect.provide(testLayer), Effect.scoped))

test("Chunker uses index-based IDs", () =>
  Effect.gen(function* () {
    const chunker = yield* Chunker
    const chunks = yield* chunker.chunkFile("src/domain/chunk.ts")
    for (let i = 0; i < chunks.length; i++) {
      expect(chunks[i].idx).toBe(i)
    }
  }).pipe(Effect.provide(testLayer), Effect.scoped))

test("Chunker skips chunks shorter than 20 characters", () =>
  Effect.gen(function* () {
    const chunker = yield* Chunker
    const chunks = yield* chunker.chunkFile("src/domain/chunk.ts")
    for (const chunk of chunks) {
      expect(chunk.text.length).toBeGreaterThanOrEqual(20)
    }
  }).pipe(Effect.provide(testLayer), Effect.scoped))
