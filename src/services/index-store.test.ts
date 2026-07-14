import { Effect, Layer, Stream } from "effect"
import { FileSystem } from "effect/FileSystem"
import { expect, test } from "vite-plus/test"

import { makeChunk, makeEmbedding, makeStoredChunk } from "../../tests/test-utils/fixtures.js"
import { memoryFsLayer } from "../../tests/test-utils/memfs.js"
import { testLayer } from "../../tests/test-utils/testLayer.js"
import { GetStatus } from "../application/get-status.js"
import { StoreError } from "../domain/errors.js"
import { IndexStore } from "../domain/ports.js"
import { buildBm25Index } from "../lib/retrieval/bm25.js"
import { IndexStoreLive } from "./index-store.js"

const isLayer = Layer.provideMerge(IndexStoreLive, memoryFsLayer({}))

const storeFixture = (
  chunks: ReturnType<typeof makeChunk>[],
  embeddings: ReturnType<typeof makeEmbedding>[],
) =>
  Effect.gen(function* () {
    const store = yield* IndexStore
    yield* store.persistIndex({
      chunks: Stream.fromIterable(chunks).pipe(
        Stream.map((chunk, i) => [makeStoredChunk(chunk), embeddings[i]!] as const),
        Stream.map((pair) => [pair] as const),
      ),
      identifierIndex: { exact: {}, split: {} },
      bm25Index: buildBm25Index(chunks.map((chunk, index) => ({ index, text: chunk.text }))),
      files: [],
      dims: 384,
      dtype: "fp32",
      embeddingCache: [],
    })
    return store
  })

test("IndexStore.getStatus returns 0 when no index exists", () =>
  Effect.gen(function* () {
    const result = yield* (yield* GetStatus).getStatus()
    expect(result.chunks).toBe(0)
    expect(result.files).toBe(0)
    expect(result.model).toBe("")
    expect(result.lastIndex).toBe(0)
    expect(result.totalLines).toBe(0)
    expect(result.byteSize).toBe(0)
  }).pipe(Effect.provide(testLayer({ cleanStore: true })), Effect.scoped))

test("IndexStore.reset returns 0/0/false when no index exists", () =>
  Effect.gen(function* () {
    const store = yield* IndexStore
    const resetResult = yield* store.reset()
    expect(resetResult.deletedChunks).toBe(false)
    expect(resetResult.deletedVectors).toBe(false)
    expect(resetResult.freedBytes).toBe(0)
  }).pipe(Effect.provide(Layer.provideMerge(IndexStoreLive, memoryFsLayer({}))), Effect.scoped))

test("IndexStore.persistIndex writes chunks and vectors to index files", () =>
  Effect.gen(function* () {
    const store = yield* storeFixture([makeChunk()], [makeEmbedding()])
    const status = yield* store.getStatus()
    expect(status.chunks).toBe(1)
    expect(status.files).toBe(1)
    expect(status.totalLines).toBe(1)
  }).pipe(Effect.provide(isLayer), Effect.scoped))

test("IndexStore.persistIndex stores metadata without source text", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem
    yield* storeFixture([makeChunk()], [makeEmbedding()])

    const stored = yield* fs.readFileString(".pix/chunks.jsonl")
    expect(stored).not.toContain('"text"')
    expect(stored).not.toContain("contextBefore")
    expect(yield* fs.exists(".pix/files.jsonl")).toBe(true)
  }).pipe(Effect.provide(isLayer), Effect.scoped))

test("IndexStore.clearEmbeddingCache removes persisted embeddings", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem
    const store = yield* storeFixture([makeChunk()], [makeEmbedding()])
    expect(yield* fs.exists(".pix/embedding-cache.jsonl")).toBe(true)

    expect(yield* store.clearEmbeddingCache()).toBe(true)
    expect(yield* fs.exists(".pix/embedding-cache.jsonl")).toBe(false)
  }).pipe(Effect.provide(isLayer), Effect.scoped))

test("IndexStore.loadSource hydrates only the requested source range", () =>
  Effect.gen(function* () {
    const store = yield* storeFixture(
      [makeChunk({ file: "src/test.ts", text: "hello", startOffset: 0, endOffset: 5 })],
      [makeEmbedding()],
    )
    const source = yield* store.loadSource({
      file: "src/test.ts",
      startLine: 1,
      endLine: 1,
      startOffset: 0,
      endOffset: 5,
      contentHash: makeStoredChunk({ text: "hello" }).contentHash,
      contextLines: 1,
    })

    expect(source).toEqual({ text: "hello", contextBefore: null, contextAfter: "world" })
  }).pipe(
    Effect.provide(
      Layer.provideMerge(IndexStoreLive, memoryFsLayer({ "src/test.ts": "hello\nworld" })),
    ),
    Effect.scoped,
  ))

test("IndexStore.reset deletes index files when they exist", () =>
  Effect.gen(function* () {
    yield* storeFixture([makeChunk()], [makeEmbedding()])
    const store = yield* IndexStore
    const result = yield* store.reset()
    expect(result.deletedChunks).toBe(true)
    expect(result.deletedVectors).toBe(true)
    expect(result.freedBytes).toBeGreaterThan(0)
  }).pipe(Effect.provide(isLayer), Effect.scoped))

test("IndexStore.persistIndex works when .pix directory already exists", () =>
  Effect.gen(function* () {
    const store = yield* storeFixture([makeChunk()], [makeEmbedding()])
    const status = yield* store.getStatus()
    expect(status.chunks).toBe(1)
  }).pipe(
    Effect.provide(Layer.provideMerge(IndexStoreLive, memoryFsLayer({ ".pix": null }))),
    Effect.scoped,
  ))

test("IndexStore.getStatus handles chunks.jsonl with malformed lines", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem
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
  }).pipe(Effect.provide(isLayer), Effect.scoped))

test("IndexStore.persistIndex writes bm25.json", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem
    yield* storeFixture([makeChunk()], [makeEmbedding()])
    const exists = yield* fs.exists(".pix/bm25.json")
    expect(exists).toBe(true)
  }).pipe(Effect.provide(isLayer), Effect.scoped))

test("IndexStore.loadSearchData returns bm25Index after indexing", () =>
  Effect.gen(function* () {
    yield* storeFixture(
      [
        makeChunk({ id: "a1", idx: 0, text: "function handleRequest(req)" }),
        makeChunk({ id: "a2", idx: 1, text: "const x = 1" }),
      ],
      [makeEmbedding(0.1), makeEmbedding(0.1)],
    )
    const store = yield* IndexStore
    const data = yield* store.loadSearchData()
    expect(data.entries).toHaveLength(2)
    expect(data.bm25Index).not.toBeNull()
    expect(data.bm25Index!.chunkLengths).toHaveLength(2)
    expect(data.bm25Index!.chunkLengths).toEqual([3, 3])
  }).pipe(Effect.provide(isLayer), Effect.scoped))

test("IndexStore.reset deletes bm25.json", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem
    yield* storeFixture([makeChunk()], [makeEmbedding()])
    const store = yield* IndexStore
    yield* store.reset()
    const exists = yield* fs.exists(".pix/bm25.json")
    expect(exists).toBe(false)
  }).pipe(Effect.provide(isLayer), Effect.scoped))

test("IndexStore.loadSearchData fails when bm25.json is missing", () =>
  Effect.gen(function* () {
    yield* storeFixture([makeChunk()], [makeEmbedding()])
    const fs = yield* FileSystem
    yield* fs.remove(".pix/bm25.json")
    const store = yield* IndexStore
    const result = yield* Effect.result(store.loadSearchData())
    expect(result._tag).toBe("Failure")
  }).pipe(Effect.provide(isLayer), Effect.scoped))

test("IndexStore.persistIndex aborts and cleans up when stream errors mid-write", () =>
  Effect.gen(function* () {
    const store = yield* IndexStore
    const fs = yield* FileSystem

    const okBatch = [[makeStoredChunk(), makeEmbedding()]] as const
    const failingStream: Stream.Stream<typeof okBatch, StoreError> = Stream.fromEffect(
      Effect.succeed(okBatch),
    ).pipe(
      Stream.concat(
        Stream.fromEffect(Effect.fail(new StoreError({ message: "embedder crashed mid-batch" }))),
      ),
    )

    const result = yield* Effect.result(
      store.persistIndex({
        chunks: failingStream,
        identifierIndex: { exact: {}, split: {} },
        bm25Index: { avgChunkLength: 0, chunkLengths: [], docFreqs: {}, chunkTfs: {} },
        files: [],
        dims: 384,
        dtype: "fp32",
        embeddingCache: [],
      }),
    )
    expect(result._tag).toBe("Failure")

    const chunksTmpExists = yield* fs.exists(".pix/chunks.jsonl.tmp")
    const vectorsTmpExists = yield* fs.exists(".pix/vectors.bin.tmp")
    const metaTmpExists = yield* fs.exists(".pix/index-meta.json.tmp")
    const bm25TmpExists = yield* fs.exists(".pix/bm25.json.tmp")
    const identifiersTmpExists = yield* fs.exists(".pix/identifiers.json.tmp")
    expect(chunksTmpExists).toBe(false)
    expect(vectorsTmpExists).toBe(false)
    expect(metaTmpExists).toBe(false)
    expect(bm25TmpExists).toBe(false)
    expect(identifiersTmpExists).toBe(false)

    const chunksExists = yield* fs.exists(".pix/chunks.jsonl")
    const vectorsExists = yield* fs.exists(".pix/vectors.bin")
    expect(chunksExists).toBe(false)
    expect(vectorsExists).toBe(false)
  }).pipe(Effect.provide(isLayer), Effect.scoped))
