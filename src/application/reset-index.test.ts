import { Effect } from "effect"
import { expect, test } from "vite-plus/test"

import { testLayer } from "../../tests/test-utils/testLayer.js"
import { ResetIndex } from "./reset-index.js"

test("ResetIndex.reset returns zeroes when no index exists", () =>
  Effect.gen(function* () {
    const result = yield* ResetIndex.reset()
    expect(result.deletedChunks).toBe(false)
    expect(result.deletedVectors).toBe(false)
    expect(result.freedBytes).toBe(0)
  }).pipe(Effect.provide(testLayer({})), Effect.scoped))
