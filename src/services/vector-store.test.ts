import { FileSystem } from "@effect/platform"
import { Effect, Layer } from "effect"
import { expect, test } from "vite-plus/test"

import { makeChunk, makeEmbedding } from "../../tests/test-utils/fixtures.js"
import { memoryFsLayer } from "../../tests/test-utils/memfs.js"
import { testLayer } from "../../tests/test-utils/testLayer.js"
import { GetStatus } from "../application/get-status.js"
import type { Embedding } from "../domain/chunk.js"
import { VectorStore } from "../domain/ports.js"
import { VectorStoreLive } from "./vector-store.js"

const vsLayer = Layer.provideMerge(VectorStoreLive, memoryFsLayer({}))

const defaultQuery: Embedding = {
  vector: new Float32Array(384).fill(0.15),
  dims: 384,
  dtype: "fp32",
}

const storeFixture = (
  chunks: ReturnType<typeof makeChunk>[],
  embeddings: ReturnType<typeof makeEmbedding>[],
) =>
  Effect.gen(function* () {
    const store = yield* VectorStore
    yield* store.storeBegin()
    yield* store.storeBatch(chunks, embeddings)
    yield* store.storeCommit()
    return store
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
    const store = yield* storeFixture([makeChunk()], [makeEmbedding()])
    const status = yield* store.getStatus()
    expect(status.chunks).toBe(1)
    expect(status.files).toBe(1)
    expect(status.totalLines).toBe(1)
  }).pipe(Effect.provide(vsLayer), Effect.scoped))

test("VectorStoreLive.search returns results after storing chunks", () =>
  Effect.gen(function* () {
    const store = yield* storeFixture(
      [makeChunk(), makeChunk({ id: "a2", idx: 1, startLine: 3, endLine: 4, text: "world" })],
      [makeEmbedding(0.1), makeEmbedding(0.2)],
    )
    const { results } = yield* store.search(defaultQuery, { topK: 2 })
    expect(results.length).toBe(2)
    expect(results[0].file).toBe("/test.ts")
    expect(typeof results[0].score).toBe("number")
  }).pipe(Effect.provide(vsLayer), Effect.scoped))

test("VectorStoreLive.search with ignorePaths excludes matching files", () =>
  Effect.gen(function* () {
    const store = yield* storeFixture(
      [
        makeChunk({ id: "a1", idx: 0, file: "src/services/foo.ts" }),
        makeChunk({ id: "a2", idx: 1, file: "src/test/foo.test.ts" }),
      ],
      [makeEmbedding(0.1), makeEmbedding(0.1)],
    )
    const { results } = yield* store.search(defaultQuery, {
      topK: 5,
      ignorePaths: ["**/*.test.ts"],
    })
    expect(results.length).toBe(1)
    expect(results[0].file).toBe("src/services/foo.ts")
  }).pipe(Effect.provide(vsLayer), Effect.scoped))

test("VectorStoreLive.search with onlyPaths restricts to matching files", () =>
  Effect.gen(function* () {
    const store = yield* storeFixture(
      [
        makeChunk({ id: "a1", idx: 0, file: "src/services/foo.ts" }),
        makeChunk({ id: "a2", idx: 1, file: "src/test/foo.test.ts" }),
      ],
      [makeEmbedding(0.1), makeEmbedding(0.1)],
    )
    const { results } = yield* store.search(defaultQuery, {
      topK: 5,
      onlyPaths: ["src/services/**"],
    })
    expect(results.length).toBe(1)
    expect(results[0].file).toBe("src/services/foo.ts")
  }).pipe(Effect.provide(vsLayer), Effect.scoped))

test("VectorStoreLive.search with both ignorePaths and onlyPaths applies both", () =>
  Effect.gen(function* () {
    const store = yield* storeFixture(
      [
        makeChunk({ id: "a1", idx: 0, file: "src/services/foo.ts" }),
        makeChunk({ id: "a2", idx: 1, file: "src/test/foo.test.ts" }),
        makeChunk({ id: "a3", idx: 2, file: "src/lib/bar.ts" }),
      ],
      [makeEmbedding(0.1), makeEmbedding(0.1), makeEmbedding(0.1)],
    )
    const { results } = yield* store.search(defaultQuery, {
      topK: 5,
      onlyPaths: ["src/services/**", "src/lib/**"],
      ignorePaths: ["**/bar.ts"],
    })
    expect(results.length).toBe(1)
    expect(results[0].file).toBe("src/services/foo.ts")
  }).pipe(Effect.provide(vsLayer), Effect.scoped))

test("VectorStoreLive.search with no options returns all results", () =>
  Effect.gen(function* () {
    const store = yield* storeFixture(
      [
        makeChunk({ id: "a1", idx: 0, file: "src/services/foo.ts" }),
        makeChunk({ id: "a2", idx: 1, file: "src/test/foo.test.ts" }),
      ],
      [makeEmbedding(0.1), makeEmbedding(0.1)],
    )
    const { results } = yield* store.search(defaultQuery)
    expect(results.length).toBe(2)
  }).pipe(Effect.provide(vsLayer), Effect.scoped))

test("VectorStoreLive.search returns contextBefore and contextAfter when stored", () =>
  Effect.gen(function* () {
    const store = yield* storeFixture(
      [makeChunk({ contextBefore: "line before", contextAfter: "line after" })],
      [makeEmbedding(0.1)],
    )
    const { results } = yield* store.search(defaultQuery, { topK: 5 })
    expect(results.length).toBe(1)
    expect(results[0].contextBefore).toBe("line before")
    expect(results[0].contextAfter).toBe("line after")
  }).pipe(Effect.provide(vsLayer), Effect.scoped))

test("VectorStoreLive.reset deletes index files when they exist", () =>
  Effect.gen(function* () {
    yield* storeFixture([makeChunk()], [makeEmbedding()])
    const store = yield* VectorStore
    const result = yield* store.reset()
    expect(result.deletedChunks).toBe(true)
    expect(result.deletedVectors).toBe(true)
    expect(result.freedBytes).toBeGreaterThan(0)
  }).pipe(Effect.provide(vsLayer), Effect.scoped))

test("VectorStoreLive.store works when .pix directory already exists", () =>
  Effect.gen(function* () {
    const store = yield* storeFixture([makeChunk()], [makeEmbedding()])
    const status = yield* store.getStatus()
    expect(status.chunks).toBe(1)
  }).pipe(
    Effect.provide(Layer.provideMerge(VectorStoreLive, memoryFsLayer({ ".pix": null }))),
    Effect.scoped,
  ))

test("VectorStoreLive.search skips malformed chunk lines", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const store = yield* storeFixture([makeChunk()], [makeEmbedding(0.1)])

    const current = yield* fs.readFileString(".pix/chunks.jsonl").pipe(Effect.orDie)
    yield* fs.writeFileString(".pix/chunks.jsonl", current + "{}\n").pipe(Effect.orDie)

    const { results, validationErrors } = yield* store.search(defaultQuery)
    expect(results.length).toBe(1)
    expect(validationErrors.length).toBe(1)
    expect(validationErrors[0].message).toContain("malformed")
  }).pipe(Effect.provide(vsLayer), Effect.scoped))

test("VectorStoreLive.getStatus handles chunks.jsonl with malformed lines", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const store = yield* storeFixture(
      [makeChunk(), makeChunk({ id: "a2", idx: 1, text: "line1\nline2" })],
      [makeEmbedding(0.1), makeEmbedding(0.1)],
    )

    const current = yield* fs.readFileString(".pix/chunks.jsonl").pipe(Effect.orDie)
    yield* fs.writeFileString(".pix/chunks.jsonl", current + '{"bad}\n').pipe(Effect.orDie)

    const status = yield* store.getStatus()
    expect(status.chunks).toBe(2)
    expect(status.totalLines).toBe(3)
    expect(status.files).toBe(1)
    expect(status.validationErrors.length).toBe(1)
    expect(status.validationErrors[0].message).toContain("malformed")
  }).pipe(Effect.provide(vsLayer), Effect.scoped))

test("VectorStoreLive.storeCommit writes bm25.json", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    yield* storeFixture([makeChunk()], [makeEmbedding()])
    const exists = yield* fs.exists(".pix/bm25.json")
    expect(exists).toBe(true)
  }).pipe(Effect.provide(vsLayer), Effect.scoped))

test("VectorStoreLive.loadSearchData returns bm25Index after indexing", () =>
  Effect.gen(function* () {
    yield* storeFixture(
      [
        makeChunk({ id: "a1", idx: 0, text: "function handleRequest(req)" }),
        makeChunk({ id: "a2", idx: 1, text: "const x = 1" }),
      ],
      [makeEmbedding(0.1), makeEmbedding(0.1)],
    )
    const store = yield* VectorStore
    const data = yield* store.loadSearchData()
    expect(data.entries).toHaveLength(2)
    expect(data.bm25Index).not.toBeNull()
    expect(data.bm25Index!.chunkLengths).toHaveLength(2)
    expect(data.bm25Index!.chunkLengths).toEqual([3, 3])
  }).pipe(Effect.provide(vsLayer), Effect.scoped))

test("VectorStoreLive.reset deletes bm25.json", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    yield* storeFixture([makeChunk()], [makeEmbedding()])
    const store = yield* VectorStore
    yield* store.reset()
    const exists = yield* fs.exists(".pix/bm25.json")
    expect(exists).toBe(false)
  }).pipe(Effect.provide(vsLayer), Effect.scoped))

test("VectorStoreLive.loadSearchData fails when bm25.json is missing", () =>
  Effect.gen(function* () {
    const store = yield* VectorStore
    yield* store.storeBegin()
    yield* store.storeBatch([makeChunk()], [makeEmbedding()])
    yield* store.storeCommit()

    const fs = yield* FileSystem.FileSystem
    yield* fs.remove(".pix/bm25.json")

    const result = yield* Effect.either(store.loadSearchData())
    expect(result._tag).toBe("Left")
  }).pipe(Effect.provide(vsLayer), Effect.scoped))
