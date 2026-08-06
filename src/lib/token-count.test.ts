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

it.effect("createCombinedTokenCounter evicts the least recently used count", () =>
  Effect.gen(function* () {
    let calls = 0
    const countTokens = createCombinedTokenCounter(
      () => Effect.sync(() => ++calls),
      () => Effect.succeed(0),
      2,
    )

    yield* countTokens("first")
    yield* countTokens("second")
    yield* countTokens("first")
    yield* countTokens("third")
    yield* countTokens("second")

    expect(calls).toBe(4)
  }),
)
