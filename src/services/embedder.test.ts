import { expect, it } from "@effect/vitest"
import { Effect, Layer } from "effect"

import { makeConfigJson } from "../../tests/test-utils/fixtures.js"
import { memoryFsLayer } from "../../tests/test-utils/memfs.js"
import { silentDisplay } from "../../tests/test-utils/silentDisplay.js"
import type { Embedding } from "../domain/chunk.js"
import { Embedder } from "../domain/ports.js"
import { OnnxEmbedderLive } from "./embedder.js"

const testLayer = Layer.provideMerge(
  OnnxEmbedderLive,
  Layer.merge(
    memoryFsLayer({ ".pix/config.json": makeConfigJson({ embedder: { device: "cpu" } }) }),
    silentDisplay().layer,
  ),
)

it.effect("OnnxEmbedder.embed returns Embedding with correct dims and dtype", () =>
  Effect.gen(function* () {
    const embedder = yield* Embedder

    const result1: Embedding = yield* embedder.embed("hello world")
    expect(result1.dims).toBe(384)
    expect(result1.vector.length).toBe(384)
    expect(result1.dtype).toBe("fp32")

    const result2 = yield* embedder.embed("goodbye world")
    let diff = 0
    for (let i = 0; i < result1.vector.length; i++) {
      diff += Math.abs(result1.vector[i] - result2.vector[i])
    }
    expect(diff).toBeGreaterThan(0)
  }).pipe(Effect.provide(testLayer), Effect.scoped),
)

it.effect("OnnxEmbedder.batch returns embeddings for all texts", () =>
  Effect.gen(function* () {
    const embedder = yield* Embedder
    const results = yield* embedder.batch(["hello", "world"])
    expect(results.length).toBe(2)
    expect(results[0].dtype).toBe("fp32")
    expect(results[1].dims).toBe(384)
  }).pipe(Effect.provide(testLayer), Effect.scoped),
)
