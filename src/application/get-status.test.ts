import { Effect, Layer } from "effect"
import { expect, test } from "vite-plus/test"

import { VectorStore } from "../domain/ports.js"
import { GetStatus } from "./get-status.js"

test("GetStatus returns stats from VectorStore", () =>
  Effect.gen(function* () {
    const mockStats = {
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
      getStats: () => Effect.succeed(mockStats),
      reset: () => Effect.succeed({ deletedChunks: false, deletedVectors: false, freedBytes: 0 }),
    }

    const mockLayer = Layer.succeed(VectorStore, mockStore)
    const testLayer = Layer.provideMerge(GetStatus.Default, mockLayer)

    const result = yield* GetStatus.getStatus().pipe(Effect.provide(testLayer))

    expect(result.chunks).toBe(42)
    expect(result.files).toBe(7)
    expect(result.model).toBe("Xenova/all-MiniLM-L6-v2")
    expect(result.lastIndex).toBe(1715030400000)
    expect(result.totalLines).toBe(1260)
    expect(result.byteSize).toBe(16128)
  }))
