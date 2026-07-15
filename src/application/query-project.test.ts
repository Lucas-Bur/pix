import { expect, it } from "@effect/vitest"
import { Cause, Effect, Exit, Layer, Stream } from "effect"

import {
  makeChunk,
  makeEmbedding,
  makeConfigJson,
  makeStoredChunk,
} from "../../tests/test-utils/fixtures.js"
import { testLayer } from "../../tests/test-utils/testLayer.js"
import { DEFAULT_CONFIG } from "../domain/config.js"
import { ModelMismatchError, NoIndexError } from "../domain/errors.js"
import { ConfigStore, Embedder, IndexStore } from "../domain/ports.js"
import { buildBm25Index } from "../lib/retrieval/bm25.js"
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

const hybridLayer = testLayer({
  contents: { ".pix/config.json": makeConfigJson() },
  embedderLayer: nonZeroEmbedder,
})

it.effect("QueryProject.queryProject fails with NoIndexError when no index exists", () =>
  Effect.gen(function* () {
    const error = yield* Effect.flip((yield* QueryProject).queryProject("test", { topK: 5 }))
    expect(error).toBeInstanceOf(NoIndexError)
  }).pipe(Effect.provide(testLayer({})), Effect.scoped),
)

const indexFixture = (
  chunks: Array<ReturnType<typeof makeChunk>>,
  embeddings: Array<ReturnType<typeof makeEmbedding>>,
) =>
  Effect.gen(function* () {
    const store = yield* IndexStore
    yield* store.persistIndex({
      chunks: Effect.succeed(
        chunks.map((chunk, i) => [makeStoredChunk(chunk), embeddings[i]!] as const),
      ).pipe(Stream.fromEffect),
      identifierIndex: { exact: {}, split: {} },
      bm25Index: buildBm25Index(chunks.map((chunk, index) => ({ index, text: chunk.text }))),
      files: [],
      dims: 384,
      dtype: "fp32",
      embeddingCache: [],
    })
  })

it.effect("QueryProject.queryProject returns hybrid-ranked results via RRF", () =>
  Effect.gen(function* () {
    yield* indexFixture(
      [
        makeChunk({
          id: "a1",
          idx: 0,
          text: "function handleRequest(req: Request): Response {",
          file: "src/handler.ts",
        }),
        makeChunk({
          id: "a2",
          idx: 1,
          text: "const x = 42",
          file: "src/other.ts",
        }),
      ],
      [makeEmbedding(0.1), makeEmbedding(0.1)],
    )

    const { results } = yield* (yield* QueryProject).queryProject("handleRequest", {
      topK: 5,
      noContent: true,
    })
    expect(results.length).toBeGreaterThan(0)
    expect(results[0].file).toBe("src/handler.ts")
  }).pipe(Effect.provide(hybridLayer), Effect.scoped),
)

it.effect("QueryProject.queryProject respects ignorePaths with hybrid search", () =>
  Effect.gen(function* () {
    yield* indexFixture(
      [
        makeChunk({ id: "a1", idx: 0, file: "src/keep.ts", text: "function handleRequest" }),
        makeChunk({
          id: "a2",
          idx: 1,
          file: "src/ignore.ts",
          text: "function handleRequest here too",
        }),
      ],
      [makeEmbedding(0.1), makeEmbedding(0.1)],
    )

    const { results } = yield* (yield* QueryProject).queryProject("handleRequest", {
      topK: 5,
      ignorePaths: ["**/ignore*"],
      noContent: true,
    })
    expect(results.length).toBe(1)
    expect(results[0].file).toBe("src/keep.ts")
  }).pipe(Effect.provide(hybridLayer), Effect.scoped),
)

it.effect("QueryProject.queryProject respects onlyPaths with hybrid search", () =>
  Effect.gen(function* () {
    yield* indexFixture(
      [
        makeChunk({ id: "a1", idx: 0, file: "src/keep.ts", text: "function handleRequest" }),
        makeChunk({
          id: "a2",
          idx: 1,
          file: "lib/other.ts",
          text: "function handleRequest here too",
        }),
      ],
      [makeEmbedding(0.1), makeEmbedding(0.1)],
    )

    const { results } = yield* (yield* QueryProject).queryProject("handleRequest", {
      topK: 5,
      onlyPaths: ["src/**"],
      noContent: true,
    })
    expect(results.length).toBe(1)
    expect(results[0].file).toBe("src/keep.ts")
  }).pipe(Effect.provide(hybridLayer), Effect.scoped),
)

it.effect(
  "QueryProject.queryProject fails with ModelMismatchError when config model differs from index",
  () =>
    Effect.gen(function* () {
      yield* indexFixture(
        [makeChunk({ id: "a1", idx: 0, text: "function handleRequest", file: "src/handler.ts" })],
        [makeEmbedding(0.1)],
      )

      yield* (yield* ConfigStore).writeConfig({
        ...DEFAULT_CONFIG,
        embedder: { ...DEFAULT_CONFIG.embedder, model: "Xenova/bge-small-en-v1.5" },
      })

      const exit = yield* Effect.exit(
        (yield* QueryProject).queryProject("handleRequest", { topK: 5, noContent: true }),
      )

      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        const failure = Cause.findErrorOption(exit.cause)
        expect(failure._tag).toBe("Some")
        if (failure._tag === "Some") {
          expect(failure.value).toBeInstanceOf(ModelMismatchError)
        }
      }
    }).pipe(
      Effect.provide(
        testLayer({
          embedderLayer: nonZeroEmbedder,
          contents: { ".pix/config.json": makeConfigJson() },
        }),
      ),
      Effect.scoped,
    ),
)
