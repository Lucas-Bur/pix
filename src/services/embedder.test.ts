import { Effect, Layer } from "effect"
import { expect, test } from "vite-plus/test"

import { memoryFsLayer } from "../../tests/test-utils/memfs.js"
import type { Embedding } from "../domain/embedding.js"
import { Embedder, OnnxEmbedderLive } from "./embedder.ts"

const embedderConfig = {
  schema: "1",
  embedder: {
    model: "Xenova/all-MiniLM-L6-v2",
    device: "auto" as const,
    dtype: "fp32" as const,
  },
  chunkLines: 60,
  overlapLines: 10,
  skipExtensions: [],
  ignoredPaths: [],
}

const testLayer = Layer.provideMerge(
  OnnxEmbedderLive,
  memoryFsLayer({ ".pix/config.json": JSON.stringify(embedderConfig) }),
)

test("OnnxEmbedder.embed returns normalized Embedding with correct dims", () =>
  Effect.gen(function* () {
    const embedder = yield* Embedder

    const result1: Embedding = yield* embedder.embed("hello world")
    expect(result1.dims).toBe(384)
    expect(result1.vector.length).toBe(384)

    let sumSq = 0
    for (let i = 0; i < result1.vector.length; i++) {
      sumSq += result1.vector[i] * result1.vector[i]
    }
    expect(Math.sqrt(sumSq)).toBeCloseTo(1, 5)

    const result2 = yield* embedder.embed("goodbye world")
    let diff = 0
    for (let i = 0; i < result1.vector.length; i++) {
      diff += Math.abs(result1.vector[i] - result2.vector[i])
    }
    expect(diff).toBeGreaterThan(0)
  }).pipe(Effect.provide(testLayer), Effect.scoped))

test("OnnxEmbedder.batch returns embeddings for all texts", () =>
  Effect.gen(function* () {
    const embedder = yield* Embedder
    const results = yield* embedder.batch(["hello", "world"])
    expect(results.length).toBe(2)
    expect(results[0].dims).toBe(384)
    expect(results[1].dims).toBe(384)
  }).pipe(Effect.provide(testLayer), Effect.scoped))
