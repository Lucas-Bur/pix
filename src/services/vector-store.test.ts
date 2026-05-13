import { Effect, Layer } from "effect"
import { expect, test } from "vite-plus/test"

import { memoryFsLayer } from "../../tests/test-utils/memfs.js"
import { testLayer } from "../../tests/test-utils/testLayer.js"
import { GetStatus } from "../application/get-status.js"
import { VectorStore } from "../domain/ports.js"
import { VectorStoreLive } from "./vector-store.js"

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
