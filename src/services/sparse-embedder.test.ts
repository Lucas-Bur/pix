import { expect, it } from "@effect/vitest"
import { Effect, Layer } from "effect"

import { makeConfigJson } from "../../tests/test-utils/fixtures.js"
import { memoryFsLayer } from "../../tests/test-utils/memfs.js"
import { SparseEmbedder } from "../domain/ports.js"
import { SparseEmbedderLive } from "./sparse-embedder.js"

const testLayer = Layer.provideMerge(
  SparseEmbedderLive,
  memoryFsLayer({
    ".pix/config.json": makeConfigJson({ sparseEmbedder: { device: "cpu" } }),
  }),
)

// This adapter test downloads the pinned model; enable it explicitly for integration runs.
it.effect.skipIf(process.env.PIX_RUN_MODEL_TESTS !== "1")(
  "SparseEmbedder loads the pinned model and encodes documents and queries",
  () =>
    Effect.gen(function* () {
      const embedder = yield* SparseEmbedder
      const documents = yield* embedder.batch(["SQLite sparse retrieval", "Effect service layers"])
      const idf = yield* embedder.loadIdf()
      const query = yield* embedder.tokenizeQuery("SQLite retrieval")

      expect(documents).toHaveLength(2)
      expect(documents.every(({ terms }) => terms.length > 0)).toBe(true)
      expect(idf.length).toBeGreaterThan(30_000)
      expect(query.tokenIds.length).toBeGreaterThan(0)
      expect(query.contract).toEqual(embedder.contract)
    }).pipe(Effect.provide(testLayer), Effect.scoped),
  120_000,
)
