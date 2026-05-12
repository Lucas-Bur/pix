import { Effect, Layer } from "effect"
import { expect, test } from "vite-plus/test"

import { VectorStore } from "../domain/ports.js"
import { ResetIndex } from "./reset-index.js"

test("ResetIndex.reset calls store.reset() and returns result", () =>
  Effect.gen(function* () {
    let resetCalled = false
    const mockResult = {
      deletedChunks: true,
      deletedVectors: true,
      freedBytes: 4096,
    }

    const mockStore = {
      store: () => Effect.succeed(undefined),
      search: () => Effect.succeed([]),
      getStats: () =>
        Effect.succeed({
          chunks: 0,
          files: 0,
          model: "",
          lastIndex: 0,
          totalLines: 0,
          byteSize: 0,
        }),
      reset: () =>
        Effect.sync(() => {
          resetCalled = true
          return mockResult
        }),
    }

    const mockLayer = Layer.succeed(VectorStore, mockStore)
    const testLayer = Layer.provideMerge(ResetIndex.Default, mockLayer)

    const result = yield* ResetIndex.reset().pipe(Effect.provide(testLayer))

    expect(resetCalled).toBe(true)
    expect(result.deletedChunks).toBe(true)
    expect(result.deletedVectors).toBe(true)
    expect(result.freedBytes).toBe(4096)
  }))

test("ResetIndex.reset returns zeroes when nothing to delete", () =>
  Effect.gen(function* () {
    const mockResult = {
      deletedChunks: false,
      deletedVectors: false,
      freedBytes: 0,
    }

    const mockStore = {
      store: () => Effect.succeed(undefined),
      search: () => Effect.succeed([]),
      getStats: () =>
        Effect.succeed({
          chunks: 0,
          files: 0,
          model: "",
          lastIndex: 0,
          totalLines: 0,
          byteSize: 0,
        }),
      reset: () => Effect.succeed(mockResult),
    }

    const mockLayer = Layer.succeed(VectorStore, mockStore)
    const testLayer = Layer.provideMerge(ResetIndex.Default, mockLayer)

    const result = yield* ResetIndex.reset().pipe(Effect.provide(testLayer))

    expect(result.deletedChunks).toBe(false)
    expect(result.deletedVectors).toBe(false)
    expect(result.freedBytes).toBe(0)
  }))
