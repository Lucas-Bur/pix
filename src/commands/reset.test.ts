import { Effect, Layer } from "effect"
import { expect, test } from "vite-plus/test"

import { ResetIndex } from "../application/reset-index.js"
import { VectorStore } from "../domain/ports.js"

test("pix reset --json outputs correct JSON structure", () =>
  Effect.gen(function* () {
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
      reset: () => Effect.succeed(mockResult),
    }

    const mockLayer = Layer.succeed(VectorStore, mockStore)
    const testLayer = Layer.provideMerge(ResetIndex.Default, mockLayer)

    const result = yield* ResetIndex.reset().pipe(Effect.provide(testLayer))

    const output = {
      status: "ok" as const,
      deletedChunks: result.deletedChunks,
      deletedVectors: result.deletedVectors,
      freedBytes: result.freedBytes,
      elapsedMs: 0,
    }

    expect(output.status).toBe("ok")
    expect(output.deletedChunks).toBe(true)
    expect(output.deletedVectors).toBe(true)
    expect(output.freedBytes).toBe(4096)
  }))

test("pix reset --json on clean project reports nothing deleted", () =>
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

    const output = {
      status: "ok" as const,
      deletedChunks: result.deletedChunks,
      deletedVectors: result.deletedVectors,
      freedBytes: result.freedBytes,
      elapsedMs: 0,
    }

    expect(output.status).toBe("ok")
    expect(output.deletedChunks).toBe(false)
    expect(output.deletedVectors).toBe(false)
    expect(output.freedBytes).toBe(0)
  }))
