import { Cause, Effect, Exit, Layer } from "effect"
import { expect, test } from "vite-plus/test"

import { makeChunk, makeEmbedding, makeConfigJson } from "../../tests/test-utils/fixtures.js"
import { testLayer } from "../../tests/test-utils/testLayer.js"
import { ModelMismatchError } from "../domain/errors.js"
import { Embedder, IndexStore } from "../domain/ports.js"
import { QueryProject } from "./query-project.js"

const nonZeroEmbedder = Layer.succeed(Embedder, {
  embed: () =>
    Effect.succeed({
      vector: new Float32Array(384).fill(0.15),
      dims: 384,
      dtype: "fp32" as const,
    }),
  batch: (texts: readonly string[]) =>
    Effect.succeed(
      texts.map(() => ({
        vector: new Float32Array(384).fill(0.15),
        dims: 384,
        dtype: "fp32" as const,
      })),
    ),
  getFallbackInfo: () => Effect.succeed(undefined),
  createForDevice: () =>
    Effect.succeed({
      embed: () =>
        Effect.succeed({
          vector: new Float32Array(384).fill(0.15),
          dims: 384,
          dtype: "fp32" as const,
        }),
      batch: (texts: readonly string[]) =>
        Effect.succeed(
          texts.map(() => ({
            vector: new Float32Array(384).fill(0.15),
            dims: 384,
            dtype: "fp32" as const,
          })),
        ),
    }),
})

const hybridLayer = testLayer({ embedderLayer: nonZeroEmbedder })

test("QueryProject.queryProject returns empty results when no index exists", () =>
  Effect.gen(function* () {
    const result = yield* (yield* QueryProject).queryProject("test", { topK: 5 })
    expect(result).toEqual({ results: [], validationErrors: [] })
  }).pipe(Effect.provide(testLayer({})), Effect.scoped))

const indexFixture = (
  chunks: Array<ReturnType<typeof makeChunk>>,
  embeddings: Array<ReturnType<typeof makeEmbedding>>,
) =>
  Effect.gen(function* () {
    const store = yield* IndexStore
    yield* store.storeBegin()
    yield* store.storeBatch(chunks, embeddings)
    yield* store.storeCommit()
  })

test("QueryProject.queryProject returns hybrid-ranked results via RRF", () =>
  Effect.gen(function* () {
    yield* indexFixture(
      [
        makeChunk({
          id: "a1",
          idx: 0,
          text: "function handleRequest(req: Request): Response {",
          file: "/src/handler.ts",
        }),
        makeChunk({
          id: "a2",
          idx: 1,
          text: "const x = 42",
          file: "/src/other.ts",
        }),
      ],
      [makeEmbedding(0.1), makeEmbedding(0.1)],
    )

    const { results } = yield* (yield* QueryProject).queryProject("handleRequest", { topK: 5 })
    expect(results.length).toBeGreaterThan(0)
    expect(results[0].file).toBe("/src/handler.ts")
  }).pipe(Effect.provide(hybridLayer), Effect.scoped))

test("QueryProject.queryProject respects ignorePaths with hybrid search", () =>
  Effect.gen(function* () {
    yield* indexFixture(
      [
        makeChunk({ id: "a1", idx: 0, file: "/src/keep.ts", text: "function handleRequest" }),
        makeChunk({
          id: "a2",
          idx: 1,
          file: "/src/ignore.ts",
          text: "function handleRequest here too",
        }),
      ],
      [makeEmbedding(0.1), makeEmbedding(0.1)],
    )

    const { results } = yield* (yield* QueryProject).queryProject("handleRequest", {
      topK: 5,
      ignorePaths: ["**/ignore*"],
    })
    expect(results.length).toBe(1)
    expect(results[0].file).toBe("/src/keep.ts")
  }).pipe(Effect.provide(hybridLayer), Effect.scoped))

test("QueryProject.queryProject respects onlyPaths with hybrid search", () =>
  Effect.gen(function* () {
    yield* indexFixture(
      [
        makeChunk({ id: "a1", idx: 0, file: "/src/keep.ts", text: "function handleRequest" }),
        makeChunk({
          id: "a2",
          idx: 1,
          file: "/lib/other.ts",
          text: "function handleRequest here too",
        }),
      ],
      [makeEmbedding(0.1), makeEmbedding(0.1)],
    )

    const { results } = yield* (yield* QueryProject).queryProject("handleRequest", {
      topK: 5,
      onlyPaths: ["/src/**"],
    })
    expect(results.length).toBe(1)
    expect(results[0].file).toBe("/src/keep.ts")
  }).pipe(Effect.provide(hybridLayer), Effect.scoped))

test("QueryProject.queryProject fails with ModelMismatchError when config model differs from index", () =>
  Effect.gen(function* () {
    yield* indexFixture(
      [makeChunk({ id: "a1", idx: 0, text: "function handleRequest", file: "/src/handler.ts" })],
      [makeEmbedding(0.1)],
    )

    const configWithDifferentModel = makeConfigJson({
      embedder: { model: "Xenova/bge-small-en-v1.5" },
    })
    const mismatchLayer = testLayer({
      embedderLayer: nonZeroEmbedder,
      contents: { ".pix/config.json": configWithDifferentModel },
    })

    const exit = yield* Effect.exit(
      (yield* QueryProject).queryProject("handleRequest", { topK: 5 }),
    ).pipe(Effect.provide(mismatchLayer), Effect.scoped)

    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) {
      const failure = Cause.findErrorOption(exit.cause)
      expect(failure._tag).toBe("Some")
      if (failure._tag === "Some") {
        expect(failure.value).toBeInstanceOf(ModelMismatchError)
      }
    }
  }).pipe(Effect.provide(hybridLayer), Effect.scoped))
