import { expect, it } from "@effect/vitest"
import { Effect } from "effect"

import { indexFixtures, indexSeed } from "../../tests/test-utils/command.js"
import { testLayer } from "../../tests/test-utils/testLayer.js"
import { runIndex } from "./run-index.js"

it.effect("runIndex refreshes through the shared application API", () =>
  Effect.gen(function* () {
    const result = yield* runIndex({})

    expect(result.success).toBe(true)
    expect(result.refresh).toBe("none")
  }).pipe(Effect.provide(testLayer({ contents: indexFixtures, indexSeed }))),
)
