import { Context, Effect, Layer } from "effect"

import type { DiskFullError, StoreError } from "../domain/errors.js"
import { IndexStore } from "../domain/ports.js"
import type { ResetResult } from "../domain/ports.js"

/** Use case: reset the project index. Depends on IndexStore via Effect tag. */
export class ResetIndex extends Context.Service<
  ResetIndex,
  {
    readonly reset: Effect.Effect<ResetResult, StoreError | DiskFullError>
  }
>()("ResetIndex") {}

const make = Effect.gen(function* () {
  const store = yield* IndexStore
  const reset = store.reset
  return { reset } as const
})

export const ResetIndexLive = Layer.effect(ResetIndex, make)
