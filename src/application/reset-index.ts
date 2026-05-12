import type { PlatformError } from "@effect/platform/Error"
import { Effect } from "effect"

import type { ResetResult } from "../domain/ports.js"
import { VectorStore } from "../domain/ports.js"

/** Use case: reset the project index. Depends on VectorStore via Effect tag. */
export class ResetIndex extends Effect.Service<ResetIndex>()("ResetIndex", {
  accessors: true,
  effect: Effect.gen(function* () {
    const store = yield* VectorStore

    const reset = (): Effect.Effect<ResetResult, PlatformError> => store.reset()

    return { reset }
  }),
}) {}
