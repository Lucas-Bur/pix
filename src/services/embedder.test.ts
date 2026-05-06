import { NodeContext } from "@effect/platform-node"
import { Effect, Layer } from "effect"
import { expect, test } from "vite-plus/test"

import type { Embedding } from "../domain/embedding.js"
import { Embedder, OnnxEmbedderLive } from "./embedder.ts"

const testLayer = Layer.provideMerge(OnnxEmbedderLive, NodeContext.layer)

test("OnnxEmbedder.embed returns Embedding with correct dims", () =>
  Effect.gen(function* () {
    const embedder = yield* Embedder
    const result: Embedding = yield* embedder.embed("hello world")
    expect(result.dims).toBe(384)
    expect(result.vector.length).toBe(384)
  }).pipe(Effect.provide(testLayer), Effect.scoped))

test("OnnxEmbedder.embed returns L2-normalized vector", () =>
  Effect.gen(function* () {
    const embedder = yield* Embedder
    const result = yield* embedder.embed("hello world")
    let sumSq = 0
    for (let i = 0; i < result.vector.length; i++) {
      sumSq += result.vector[i] * result.vector[i]
    }
    expect(Math.sqrt(sumSq)).toBeCloseTo(1, 5)
  }).pipe(Effect.provide(testLayer), Effect.scoped))

test("OnnxEmbedder.batch returns embeddings for all texts", () =>
  Effect.gen(function* () {
    const embedder = yield* Embedder
    const results = yield* embedder.batch(["hello", "world"])
    expect(results.length).toBe(2)
    expect(results[0].dims).toBe(384)
    expect(results[1].dims).toBe(384)
  }).pipe(Effect.provide(testLayer), Effect.scoped))

test("OnnxEmbedder produces different embeddings for different texts", () =>
  Effect.gen(function* () {
    const embedder = yield* Embedder
    const result1 = yield* embedder.embed("hello world")
    const result2 = yield* embedder.embed("goodbye world")
    let diff = 0
    for (let i = 0; i < result1.vector.length; i++) {
      diff += Math.abs(result1.vector[i] - result2.vector[i])
    }
    expect(diff).toBeGreaterThan(0)
  }).pipe(Effect.provide(testLayer), Effect.scoped))
