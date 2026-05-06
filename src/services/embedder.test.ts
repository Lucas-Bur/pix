import { Effect } from "effect"
import { expect, test } from "vite-plus/test"

import type { Embedding } from "../domain/embedding.js"
import { Embedder, MockEmbedderLive } from "./embedder.ts"

const testLayer = MockEmbedderLive

test("Embedder.embed returns Embedding with correct dims", () =>
  Effect.gen(function* () {
    const embedder = yield* Embedder
    const result: Embedding = yield* embedder.embed("hello world")
    expect(result.dims).toBe(384)
    expect(result.vector.length).toBe(384)
  }).pipe(Effect.provide(testLayer)))

test("Embedder.embed returns L2-normalized vector", () =>
  Effect.gen(function* () {
    const embedder = yield* Embedder
    const result = yield* embedder.embed("hello world")
    let sumSq = 0
    for (let i = 0; i < result.vector.length; i++) {
      sumSq += result.vector[i] * result.vector[i]
    }
    expect(Math.sqrt(sumSq)).toBeCloseTo(1, 5)
  }).pipe(Effect.provide(testLayer)))

test("Embedder.batch returns embeddings for all texts", () =>
  Effect.gen(function* () {
    const embedder = yield* Embedder
    const results = yield* embedder.batch(["hello", "world"])
    expect(results.length).toBe(2)
    expect(results[0].dims).toBe(384)
    expect(results[1].dims).toBe(384)
  }).pipe(Effect.provide(testLayer)))
