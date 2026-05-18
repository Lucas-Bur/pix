import { Effect } from "effect"
import { describe, expect, it } from "vite-plus/test"

import type { Embedding } from "../../domain/chunk.js"
import { serializeVectors } from "./vector-serialization.js"

const makeEmbedding = (vector: number[], dims?: number): Embedding => ({
  vector: new Float32Array(vector),
  dims: dims ?? vector.length,
  dtype: "fp32",
})

describe("serializeVectors", () => {
  it("serializes embeddings to Buffer", () =>
    Effect.gen(function* () {
      const embeddings = [makeEmbedding([1, 2]), makeEmbedding([3, 4])]
      const buffer = yield* serializeVectors(embeddings)
      const floats = new Float32Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / 4)
      expect(Array.from(floats)).toEqual([1, 2, 3, 4])
    }).pipe(Effect.runPromise))

  it("fails for empty embeddings", () =>
    Effect.gen(function* () {
      const result = yield* Effect.either(serializeVectors([]))
      expect(result._tag).toBe("Left")
    }).pipe(Effect.runPromise))

  it("uses correct byte size", () =>
    Effect.gen(function* () {
      const embeddings = [makeEmbedding([1, 2, 3])]
      const buffer = yield* serializeVectors(embeddings)
      expect(buffer.byteLength).toBe(12)
    }).pipe(Effect.runPromise))

  it("fails when embedding dims are inconsistent", () =>
    Effect.gen(function* () {
      const embeddings = [makeEmbedding([1, 2, 3], 3), makeEmbedding([4, 5], 2)]
      const result = yield* Effect.either(serializeVectors(embeddings))
      expect(result._tag).toBe("Left")
    }).pipe(Effect.runPromise))

  it("fails when vector length does not match dims", () =>
    Effect.gen(function* () {
      const embeddings = [makeEmbedding([1, 2, 3], 3), makeEmbedding([4, 5, 6], 2)]
      const result = yield* Effect.either(serializeVectors(embeddings))
      expect(result._tag).toBe("Left")
    }).pipe(Effect.runPromise))
})
