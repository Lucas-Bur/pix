import { expect, it } from "@effect/vitest"
import { Effect } from "effect"

import { testLayer } from "../../tests/test-utils/testLayer.js"
import { ResetIndex } from "./reset-index.js"

it.effect("ResetIndex.reset returns zeroes when no index exists", () =>
  Effect.gen(function* () {
    const result = yield* (yield* ResetIndex).reset()
    expect(result.deletedChunks).toBe(false)
    expect(result.deletedVectors).toBe(false)
    expect(result.freedBytes).toBe(0)
  }).pipe(Effect.provide(testLayer({})), Effect.scoped),
)
