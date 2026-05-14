import { Effect, Layer } from "effect"
import { expect, test } from "vite-plus/test"

import { memoryFsLayer } from "../../tests/test-utils/memfs.js"
import { testLayer } from "../../tests/test-utils/testLayer.js"
import { GetStatus } from "../application/get-status.js"
import type { Chunk } from "../domain/chunk.js"
import type { Embedding } from "../domain/embedding.js"
import { VectorStore } from "../domain/ports.js"
import { VectorStoreLive } from "./vector-store.js"

const vsLayer = Layer.provideMerge(VectorStoreLive, memoryFsLayer({}))

const makeChunk = (overrides?: Partial<Chunk>): Chunk => ({
  id: "a1",
  idx: 0,
  file: "/test.ts",
  startLine: 1,
  endLine: 2,
  text: "hello",
  ...overrides,
})

const makeEmbedding = (fill: number = 0.1): Embedding => ({
  vector: new Float32Array(384).fill(fill),
  dims: 384,
})

test("FileSystemVectorStore.getStatus returns 0 when no index exists", () =>
  Effect.gen(function* () {
    const result = yield* GetStatus.getStatus()
    expect(result.chunks).toBe(0)
    expect(result.files).toBe(0)
    expect(result.model).toBe("")
    expect(result.lastIndex).toBe(0)
    expect(result.totalLines).toBe(0)
    expect(result.byteSize).toBe(0)
  }).pipe(Effect.provide(testLayer({ cleanStore: true })), Effect.scoped))

test("VectorStoreLive.reset returns 0/0/false when no index exists", () =>
  Effect.gen(function* () {
    const store = yield* VectorStore
    const resetResult = yield* store.reset()
    expect(resetResult.deletedChunks).toBe(false)
    expect(resetResult.deletedVectors).toBe(false)
    expect(resetResult.freedBytes).toBe(0)
  }).pipe(Effect.provide(Layer.provideMerge(VectorStoreLive, memoryFsLayer({}))), Effect.scoped))

test("VectorStoreLive.store writes chunks and vectors to index files", () =>
  Effect.gen(function* () {
    const store = yield* VectorStore
    const chunks = [makeChunk()]
    const embeddings = [makeEmbedding()]
    yield* store.store(chunks, embeddings)

    const status = yield* store.getStatus()
    expect(status.chunks).toBe(1)
    expect(status.files).toBe(1)
    expect(status.totalLines).toBe(1)
  }).pipe(Effect.provide(vsLayer), Effect.scoped))

test("VectorStoreLive.search returns results after storing chunks", () =>
  Effect.gen(function* () {
    const store = yield* VectorStore
    const chunks = [
      makeChunk(),
      makeChunk({ id: "a2", idx: 1, startLine: 3, endLine: 4, text: "world" }),
    ]
    const embeddings = [makeEmbedding(0.1), makeEmbedding(0.2)]
    yield* store.store(chunks, embeddings)

    const query = { vector: new Float32Array(384).fill(0.15), dims: 384 }
    const results = yield* store.search(query, 2)
    expect(results.length).toBe(2)
    expect(results[0].file).toBe("/test.ts")
    expect(typeof results[0].score).toBe("number")
  }).pipe(Effect.provide(vsLayer), Effect.scoped))

test("VectorStoreLive.reset deletes index files when they exist", () =>
  Effect.gen(function* () {
    const store = yield* VectorStore
    const chunks = [makeChunk()]
    const embeddings = [makeEmbedding()]
    yield* store.store(chunks, embeddings)

    const result = yield* store.reset()
    expect(result.deletedChunks).toBe(true)
    expect(result.deletedVectors).toBe(true)
    expect(result.freedBytes).toBeGreaterThan(0)
  }).pipe(Effect.provide(vsLayer), Effect.scoped))

test("VectorStoreLive.store works when .pix directory already exists", () =>
  Effect.gen(function* () {
    const store = yield* VectorStore
    const chunks = [makeChunk()]
    const embeddings = [makeEmbedding()]
    yield* store.store(chunks, embeddings)
    const status = yield* store.getStatus()
    expect(status.chunks).toBe(1)
  }).pipe(
    Effect.provide(Layer.provideMerge(VectorStoreLive, memoryFsLayer({ ".pix": null }))),
    Effect.scoped,
  ))
