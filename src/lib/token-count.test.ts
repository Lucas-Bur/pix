import { expect, it } from "@effect/vitest"
import { Effect } from "effect"

import { createCombinedTokenCounter } from "./token-count.js"

it.effect("createCombinedTokenCounter uses the larger count and caches it", () =>
  Effect.gen(function* () {
    let denseCalls = 0
    let sparseCalls = 0
    const countTokens = createCombinedTokenCounter(
      () =>
        Effect.sync(() => {
          denseCalls++
          return 8
        }),
      () =>
        Effect.sync(() => {
          sparseCalls++
          return 13
        }),
    )

    expect(yield* countTokens("same text")).toBe(13)
    expect(yield* countTokens("same text")).toBe(13)
    expect(denseCalls).toBe(1)
    expect(sparseCalls).toBe(1)
  }),
)
