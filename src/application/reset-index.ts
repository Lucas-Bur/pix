import { Effect } from "effect"

import type { DiskFullError, StoreError } from "../domain/errors.js"
import { IndexStore } from "../domain/ports.js"
import type { ResetResult } from "../domain/ports.js"

/** Use case: reset the project index. Depends on IndexStore via Effect tag. */
export class ResetIndex extends Effect.Service<ResetIndex>()("ResetIndex", {
  accessors: true,
  effect: Effect.gen(function* () {
    const store = yield* IndexStore

    const reset = (): Effect.Effect<ResetResult, StoreError | DiskFullError> => store.reset()

    return { reset }
  }),
}) {}
