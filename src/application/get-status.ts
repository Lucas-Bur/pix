import { Effect } from "effect"

import type { ChunkValidationError, StoreError } from "../domain/errors.js"
import { IndexStore } from "../domain/ports.js"

/** Return type for pix status */
export interface StatusResult {
  readonly chunks: number
  readonly files: number
  readonly model: string
  readonly lastIndex: number
  readonly totalLines: number
  readonly byteSize: number
  readonly validationErrors: readonly ChunkValidationError[]
}

/** Use case: get index statistics. Depends on IndexStore via Effect tag. */
export class GetStatus extends Effect.Service<GetStatus>()("GetStatus", {
  accessors: true,
  effect: Effect.gen(function* () {
    const store = yield* IndexStore

    const getStatus = (): Effect.Effect<StatusResult, StoreError> =>
      Effect.gen(function* () {
        return yield* store.getStatus()
      })

    return { getStatus }
  }),
}) {}
