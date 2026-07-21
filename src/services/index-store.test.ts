import { expect, it } from "@effect/vitest"
import { Effect, Layer, Stream } from "effect"
import { FileSystem } from "effect/FileSystem"
import { SqlClient } from "effect/unstable/sql"

import {
  makeChunk,
  makeConfigJson,
  makeEmbedding,
  makeStoredChunk,
} from "../../tests/test-utils/fixtures.js"
import { memoryFsLayer } from "../../tests/test-utils/memfs.js"
import { testLayer } from "../../tests/test-utils/testLayer.js"
import { GetStatus } from "../application/get-status.js"
import { StoreError } from "../domain/errors.js"
import { IndexStore } from "../domain/ports.js"
import { buildBm25Index } from "../lib/retrieval/bm25.js"
import { rankDense } from "../lib/retrieval/dense.js"
import { rrfFuse } from "../lib/retrieval/rrf.js"
import { ConfigStoreLive } from "./config-store.js"
import { SqliteIndexStoreBase } from "./sqlite-index-store.js"
import { sqliteIndexDatabaseLayer } from "./sqlite-index-store/client.js"

const indexStoreLayer = (contents: Record<string, string | null> = {}) =>
  Layer.provideMerge(
    Layer.provideMerge(
      SqliteIndexStoreBase,
      Layer.merge(ConfigStoreLive, sqliteIndexDatabaseLayer(":memory:")),
    ),
    memoryFsLayer({ ".pix/config.json": makeConfigJson(), ...contents }),
  )

const isLayer = indexStoreLayer()

const makeBasisEmbedding = (x: number, y: number) => {
  const embedding = makeEmbedding(0)
  embedding.vector[0] = x
  embedding.vector[1] = y
  return embedding
}

const makeDeterministicEmbedding = (seed: number) => {
  const embedding = makeEmbedding(0)
  let state = seed
  for (let index = 0; index < embedding.vector.length; index++) {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0
    embedding.vector[index] = state / 0xffff_ffff - 0.5
  }
  return embedding
}

const storeFixture = (
  chunks: ReturnType<typeof makeChunk>[],
  embeddings: ReturnType<typeof makeEmbedding>[],
  embeddingCache: Parameters<IndexStore["Service"]["persistIndex"]>[0]["embeddingCache"] = [],
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
      embeddingCache,
    })
    return store
  })

it.effect("IndexStore.getStatus returns 0 when no index exists", () =>
  Effect.gen(function* () {
    const result = yield* (yield* GetStatus).getStatus()
    expect(result.chunks).toBe(0)
    expect(result.files).toBe(0)
    expect(result.model).toBe("")
    expect(result.lastIndex).toBe(0)
    expect(result.totalLines).toBe(0)
    expect(result.byteSize).toBe(0)
  }).pipe(Effect.provide(testLayer({ cleanStore: true })), Effect.scoped),
)

it.effect("IndexStore.reset returns 0/0/false when no index exists", () =>
  Effect.gen(function* () {
    const store = yield* IndexStore
    const resetResult = yield* store.reset()
    expect(resetResult.deletedChunks).toBe(false)
    expect(resetResult.deletedVectors).toBe(false)
    expect(resetResult.freedBytes).toBe(0)
  }).pipe(Effect.provide(indexStoreLayer()), Effect.scoped),
)

it.effect("IndexStore.persistIndex writes chunks and vectors to index files", () =>
  Effect.gen(function* () {
    const store = yield* storeFixture([makeChunk()], [makeEmbedding()])
    const status = yield* store.getStatus()
    expect(status.chunks).toBe(1)
    expect(status.files).toBe(1)
    expect(status.totalLines).toBe(2)
  }).pipe(Effect.provide(isLayer), Effect.scoped),
)

it.effect("IndexStore.persistIndex stores chunk metadata without source text", () =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    yield* storeFixture([makeChunk()], [makeEmbedding()])

    const columns = yield* sql<{ readonly name: string }>`PRAGMA table_info(chunks)`
    expect(columns.map(({ name }) => name)).not.toContain("text")
    expect(columns.map(({ name }) => name)).not.toContain("context_before")
  }).pipe(Effect.provide(isLayer), Effect.scoped),
)

it.effect("IndexStore.clearEmbeddingCache removes persisted embeddings", () =>
  Effect.gen(function* () {
    const cached = makeEmbedding(0.25)
    const store = yield* storeFixture(
      [makeChunk()],
      [makeEmbedding()],
      [{ contentHash: "cached", model: "test-model", embedding: cached }],
    )
    expect(yield* store.loadEmbeddingCache()).toHaveLength(1)

    expect(yield* store.clearEmbeddingCache()).toBe(true)
    expect(yield* store.loadEmbeddingCache()).toHaveLength(0)
  }).pipe(Effect.provide(isLayer), Effect.scoped),
)

it.effect("IndexStore.loadSource hydrates only the requested source range", () =>
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
  }).pipe(Effect.provide(indexStoreLayer({ "src/test.ts": "hello\nworld" })), Effect.scoped),
)

it.effect("IndexStore.reset deletes index files when they exist", () =>
  Effect.gen(function* () {
    yield* storeFixture([makeChunk()], [makeEmbedding()])
    const store = yield* IndexStore
    const result = yield* store.reset()
    expect(result.deletedChunks).toBe(true)
    expect(result.deletedVectors).toBe(true)
    expect(result.freedBytes).toBeGreaterThan(0)
  }).pipe(Effect.provide(isLayer), Effect.scoped),
)

it.effect("IndexStore.reset preserves the historical embedding cache", () =>
  Effect.gen(function* () {
    const cached = makeEmbedding(0.25)
    const store = yield* storeFixture(
      [makeChunk()],
      [makeEmbedding()],
      [{ contentHash: "cached", model: "test-model", embedding: cached }],
    )
    yield* store.reset()

    expect(yield* store.loadEmbeddingCache()).toHaveLength(1)
    expect((yield* store.getStatus()).chunks).toBe(0)
  }).pipe(Effect.provide(indexStoreLayer()), Effect.scoped),
)

it.effect("IndexStore.persistIndex works when .pix directory already exists", () =>
  Effect.gen(function* () {
    const store = yield* storeFixture([makeChunk()], [makeEmbedding()])
    const status = yield* store.getStatus()
    expect(status.chunks).toBe(1)
  }).pipe(Effect.provide(indexStoreLayer()), Effect.scoped),
)

it.effect("IndexStore.persistIndex removes obsolete generated flat files", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem
    yield* storeFixture([makeChunk()], [makeEmbedding()])
    for (const path of [
      ".pix/chunks.jsonl",
      ".pix/vectors.bin",
      ".pix/index-meta.json",
      ".pix/bm25.json",
      ".pix/identifiers.json",
      ".pix/files.jsonl",
      ".pix/embedding-cache.jsonl",
    ]) {
      expect(yield* fs.exists(path)).toBe(false)
    }
  }).pipe(
    Effect.provide(
      indexStoreLayer({
        ".pix/chunks.jsonl": "old",
        ".pix/vectors.bin": "old",
        ".pix/index-meta.json": "old",
        ".pix/bm25.json": "old",
        ".pix/identifiers.json": "old",
        ".pix/files.jsonl": "old",
        ".pix/embedding-cache.jsonl": "old",
      }),
    ),
    Effect.scoped,
  ),
)

it.effect("IndexStore rejects malformed chunk rows through SQLite constraints", () =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const store = yield* storeFixture(
      [makeChunk(), makeChunk({ id: "a2", idx: 1, text: "line1\nline2" })],
      [makeEmbedding(0.1), makeEmbedding(0.1)],
    )

    const insert = yield* Effect.result(
      sql`INSERT INTO chunks (ordinal, id) VALUES (99, 'malformed')`,
    )
    expect(insert._tag).toBe("Failure")

    const status = yield* store.getStatus()
    expect(status.chunks).toBe(2)
    expect(status.totalLines).toBe(4)
    expect(status.files).toBe(1)
    expect(status.validationErrors).toEqual([])
  }).pipe(Effect.provide(isLayer), Effect.scoped),
)

it.effect("IndexStore.persistIndex stores BM25 in SQLite", () =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    yield* storeFixture([makeChunk()], [makeEmbedding()])
    const rows = yield* sql<{ readonly count: number }>`
      SELECT COUNT(*) AS count FROM retrieval_indexes WHERE bm25_json IS NOT NULL
    `
    expect(rows[0]?.count).toBe(1)
  }).pipe(Effect.provide(isLayer), Effect.scoped),
)

it.effect("IndexStore.loadSearchData returns bm25Index after indexing", () =>
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
    expect(data.bm25Index!.chunkLengths).toEqual([4, 3])
  }).pipe(Effect.provide(isLayer), Effect.scoped),
)

it.effect("IndexStore.searchDense agrees with the JavaScript exact scorer", () =>
  Effect.gen(function* () {
    const embeddings = [
      makeBasisEmbedding(1, 0),
      makeBasisEmbedding(1, 1),
      makeBasisEmbedding(0, 1),
      makeBasisEmbedding(-1, 0),
    ]
    const chunks = embeddings.map((_, index) => makeChunk({ id: `chunk-${index}`, idx: index }))
    const store = yield* storeFixture(chunks, embeddings)
    const query = makeBasisEmbedding(1, 0)

    const actual = yield* store.searchDense(query)
    const expected = rankDense(
      query.vector,
      embeddings.map((embedding, index) => ({
        ...makeStoredChunk(chunks[index]),
        index,
        vector: embedding.vector,
      })),
    )

    expect(actual.map(({ chunkIndex }) => chunkIndex)).toEqual(
      expected.map(({ chunkIndex }) => chunkIndex),
    )
    expect(actual.map(({ score }) => score)).toEqual(
      expected.map(({ score }) => expect.closeTo(score, 5)),
    )
  }).pipe(Effect.provide(indexStoreLayer()), Effect.scoped),
)

it.effect("IndexStore.searchDense uses the ordinal as deterministic tie-breaker", () =>
  Effect.gen(function* () {
    const store = yield* storeFixture(
      [makeChunk({ id: "first" }), makeChunk({ id: "second", idx: 1 })],
      [makeBasisEmbedding(1, 0), makeBasisEmbedding(1, 0)],
    )
    const results = yield* store.searchDense(makeBasisEmbedding(1, 0))
    expect(results.map(({ chunkIndex }) => chunkIndex)).toEqual([0, 1])
  }).pipe(Effect.provide(indexStoreLayer()), Effect.scoped),
)

it.effect("IndexStore.searchDense rejects a query with the wrong dimensions", () =>
  Effect.gen(function* () {
    const store = yield* storeFixture([makeChunk()], [makeEmbedding()])
    const result = yield* Effect.result(
      store.searchDense({ vector: new Float32Array(3), dims: 3, dtype: "fp32" }),
    )
    expect(result._tag).toBe("Failure")
  }).pipe(Effect.provide(indexStoreLayer()), Effect.scoped),
)

for (const vectorSearch of [
  { mode: "turboquant" as const, turboQuantThreshold: 50_000 },
  { mode: "auto" as const, turboQuantThreshold: 1 },
]) {
  it.effect(`IndexStore.searchDense supports ${vectorSearch.mode} scans`, () =>
    Effect.gen(function* () {
      const store = yield* storeFixture(
        [makeChunk({ id: "nearest" }), makeChunk({ id: "other", idx: 1 })],
        [makeBasisEmbedding(1, 0), makeBasisEmbedding(0, 1)],
      )
      const results = yield* store.searchDense(makeBasisEmbedding(1, 0))
      expect(results[0]?.chunkIndex).toBe(0)
    }).pipe(
      Effect.provide(indexStoreLayer({ ".pix/config.json": makeConfigJson({ vectorSearch }) })),
      Effect.scoped,
    ),
  )
}

it.effect("IndexStore persists completed TurboQuant builds in index metadata", () =>
  Effect.gen(function* () {
    yield* storeFixture([makeChunk()], [makeEmbedding()])
    const sql = yield* SqlClient.SqlClient
    const rows = yield* sql<{ readonly quantized: number }>`
      SELECT quantized FROM index_meta WHERE id = 1
    `
    expect(rows[0]?.quantized).toBe(1)
  }).pipe(
    Effect.provide(
      indexStoreLayer({
        ".pix/config.json": makeConfigJson({
          vectorSearch: { mode: "turboquant", turboQuantThreshold: 50_000 },
        }),
      }),
    ),
    Effect.scoped,
  ),
)

it.effect("TurboQuant preserves useful dense and fused top-10 recall", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem
    const embeddings = Array.from({ length: 128 }, (_, index) =>
      makeDeterministicEmbedding(index + 1),
    )
    const chunks = embeddings.map((_, index) => makeChunk({ id: `recall-${index}`, idx: index }))
    const store = yield* storeFixture(chunks, embeddings)
    const query = makeDeterministicEmbedding(42)
    const exact = (yield* store.searchDense(query)).slice(0, 10)

    yield* fs.writeFileString(
      ".pix/config.json",
      makeConfigJson({
        vectorSearch: { mode: "turboquant", turboQuantThreshold: 50_000 },
      }),
    )
    const approximate = (yield* store.searchDense(query)).slice(0, 10)
    const exactIds = new Set(exact.map(({ chunkIndex }) => chunkIndex))
    const denseRecall = approximate.filter(({ chunkIndex }) => exactIds.has(chunkIndex)).length / 10

    const lexical = exact.filter((_, index) => index % 2 === 0)
    const exactFused = rrfFuse([lexical, exact], [1, 1]).slice(0, 10)
    const approximateFused = rrfFuse([lexical, approximate], [1, 1]).slice(0, 10)
    const exactFusedIds = new Set(exactFused.map(({ chunkIndex }) => chunkIndex))
    const fusedAgreement =
      approximateFused.filter(({ chunkIndex }) => exactFusedIds.has(chunkIndex)).length / 10

    expect(denseRecall).toBeGreaterThanOrEqual(0.7)
    expect(fusedAgreement).toBeGreaterThanOrEqual(0.7)
  }).pipe(Effect.provide(indexStoreLayer()), Effect.scoped),
)

it.effect("IndexStore.reset deletes active retrieval indexes", () =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    yield* storeFixture([makeChunk()], [makeEmbedding()])
    const store = yield* IndexStore
    yield* store.reset()
    const rows = yield* sql<{ readonly count: number }>`
      SELECT COUNT(*) AS count FROM retrieval_indexes
    `
    expect(rows[0]?.count).toBe(0)
  }).pipe(Effect.provide(isLayer), Effect.scoped),
)

it.effect("IndexStore.loadSearchData fails when retrieval indexes are missing", () =>
  Effect.gen(function* () {
    yield* storeFixture([makeChunk()], [makeEmbedding()])
    const sql = yield* SqlClient.SqlClient
    yield* sql`DELETE FROM retrieval_indexes`
    const store = yield* IndexStore
    const result = yield* Effect.result(store.loadSearchData())
    expect(result._tag).toBe("Failure")
  }).pipe(Effect.provide(isLayer), Effect.scoped),
)

it.effect("IndexStore.persistIndex rolls back when the stream fails mid-write", () =>
  Effect.gen(function* () {
    const store = yield* storeFixture(
      [makeChunk({ id: "committed", text: "committed" })],
      [makeEmbedding()],
    )

    const okBatch = [
      [makeStoredChunk({ id: "replacement", text: "replacement" }), makeEmbedding()],
    ] as const
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

    const data = yield* store.loadSearchData()
    expect(data.entries.map(({ id }) => id)).toEqual(["committed"])
  }).pipe(Effect.provide(isLayer), Effect.scoped),
)
