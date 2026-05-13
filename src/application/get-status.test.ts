import { Effect, Layer } from "effect"
import { expect, test } from "vite-plus/test"

import { ConfigStore, VectorStore } from "../domain/ports.js"
import { GetStatus } from "./get-status.js"

const mockConfig = Layer.succeed(ConfigStore, {
  readConfig: () =>
    Effect.succeed({
      schema: "1",
      model: "test-model",
      dims: 384,
      chunkLines: 60,
      overlapLines: 10,
      files: {},
    }),
  writeConfig: () => Effect.succeed(undefined),
  configExists: () => Effect.succeed(true),
})

test("GetStatus returns status from VectorStore", () =>
  Effect.gen(function* () {
    const mockStatus = {
      chunks: 42,
      files: 7,
      model: "Xenova/all-MiniLM-L6-v2",
      lastIndex: 1715030400000,
      totalLines: 1260,
      byteSize: 16128,
    }

    const mockStore = {
      store: () => Effect.succeed(undefined),
      search: () => Effect.succeed([]),
      getStatus: () => Effect.succeed(mockStatus),
      reset: () => Effect.succeed({ deletedChunks: false, deletedVectors: false, freedBytes: 0 }),
    }

    const mockLayer = Layer.mergeAll(Layer.succeed(VectorStore, mockStore), mockConfig)
    const testLayer = Layer.provideMerge(GetStatus.Default, mockLayer)

    const result = yield* GetStatus.getStatus().pipe(Effect.provide(testLayer))

    expect(result.chunks).toBe(42)
    expect(result.files).toBe(7)
    expect(result.model).toBe("test-model")
    expect(result.lastIndex).toBe(1715030400000)
    expect(result.totalLines).toBe(1260)
    expect(result.byteSize).toBe(16128)
  }))

test("GetStatus returns model from config when VectorStore model is empty", () =>
  Effect.gen(function* () {
    const mockStatus = {
      chunks: 10,
      files: 3,
      model: "",
      lastIndex: 1000000,
      totalLines: 300,
      byteSize: 4096,
    }

    const mockStore = {
      store: () => Effect.succeed(undefined),
      search: () => Effect.succeed([]),
      getStatus: () => Effect.succeed(mockStatus),
      reset: () => Effect.succeed({ deletedChunks: false, deletedVectors: false, freedBytes: 0 }),
    }

    const mockLayer = Layer.mergeAll(Layer.succeed(VectorStore, mockStore), mockConfig)
    const testLayer = Layer.provideMerge(GetStatus.Default, mockLayer)

    const result = yield* GetStatus.getStatus().pipe(Effect.provide(testLayer))

    expect(result.model).toBe("test-model")
  }))
