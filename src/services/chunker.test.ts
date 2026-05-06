import crypto from "node:crypto"

import { NodeContext } from "@effect/platform-node"
import { Effect, Layer } from "effect"
import { expect, test } from "vite-plus/test"

import { Chunker, ChunkerLive } from "./chunker.ts"
import { ConfigStoreLive } from "./config-store.js"

const testLayer = Layer.provideMerge(
  Layer.provideMerge(ChunkerLive, ConfigStoreLive),
  NodeContext.layer,
)

test("Chunker returns empty array for nonexistent file", () =>
  Effect.gen(function* () {
    const chunker = yield* Chunker
    const chunks = yield* chunker.chunkFile("nonexistent/file/that/does/not/exist.ts")
    expect(chunks).toEqual([])
  }).pipe(Effect.provide(testLayer), Effect.scoped))

test("Chunker chunks a real source file in the project", () =>
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
