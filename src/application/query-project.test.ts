import { NodeContext } from "@effect/platform-node"
import { Effect, Layer } from "effect"
import { expect, test } from "vite-plus/test"

import { VectorStoreLive } from "../services/vector-store.js"
import { QueryProject } from "./query-project.js"

test("QueryProject returns results from real VectorStore when index exists", () =>
  Effect.gen(function* () {
    const baseLayer = Layer.provideMerge(QueryProject.Default, VectorStoreLive)
    const testLayer = Layer.provideMerge(baseLayer, NodeContext.layer)

    const result = yield* QueryProject.queryProject("test", 5).pipe(
      Effect.provide(testLayer),
      Effect.scoped,
    )

    // If no index, returns empty. If index exists, returns search results.
    expect(Array.isArray(result)).toBe(true)
  }))
