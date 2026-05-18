import { FileSystem } from "@effect/platform"
import { Effect, Layer, Schema } from "effect"
import { expect, test } from "vite-plus/test"

import { memoryFsLayer } from "../../tests/test-utils/memfs.js"
import { ChunkSchema } from "../domain/chunk.js"
import { buildAndStoreBm25, loadBm25 } from "./bm25-store.js"

const parseJsonChunk = Schema.parseJson(ChunkSchema)

const makeChunkLine = (text: string, idx: number): string =>
  JSON.stringify(
    Schema.decodeUnknownSync(parseJsonChunk)({
      id: `c${idx}`,
      idx,
      file: `/test/${idx}.ts`,
      startLine: 1,
      endLine: 1,
      text,
      contextBefore: null,
      contextAfter: null,
    }),
  )

const bm25Layer = Layer.provideMerge(
  Layer.effect(
    FileSystem.FileSystem,
    Effect.map(FileSystem.FileSystem, (fs) => fs),
  ),
  memoryFsLayer({}),
)

test("buildAndStoreBm25 writes bm25.json", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const content = `${makeChunkLine("function handleRequest(req)", 0)}\n${makeChunkLine("const x = 1", 1)}\n`
    yield* buildAndStoreBm25(fs, content, ".pix/bm25.json")
    const exists = yield* fs.exists(".pix/bm25.json")
    expect(exists).toBe(true)
  }).pipe(Effect.provide(bm25Layer), Effect.scoped))

test("loadBm25 reads bm25.json", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const content = `${makeChunkLine("function handleRequest(req)", 0)}\n`
    yield* buildAndStoreBm25(fs, content, ".pix/bm25.json")
    const index = yield* loadBm25(fs, ".pix/bm25.json")
    expect(index.chunkLengths).toHaveLength(1)
  }).pipe(Effect.provide(bm25Layer), Effect.scoped))

test("loadBm25 fails when file missing", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const result = yield* Effect.either(loadBm25(fs, ".pix/bm25.json"))
    expect(result._tag).toBe("Left")
  }).pipe(Effect.provide(bm25Layer), Effect.scoped))
