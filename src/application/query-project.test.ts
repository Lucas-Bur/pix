import { Effect } from "effect"
import { expect, test } from "vite-plus/test"

import { testLayer } from "../../tests/test-utils/testLayer.js"
import { QueryProject } from "./query-project.js"

test("QueryProject.queryProject returns empty array when no index exists", () =>
  Effect.gen(function* () {
    const result = yield* QueryProject.queryProject("test", { topK: 5 })
    expect(result).toEqual([])
  }).pipe(Effect.provide(testLayer({})), Effect.scoped))
