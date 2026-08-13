import { Context, Effect, Layer } from "effect"

import type { IndexDiagnostic } from "../domain/diagnostics.js"
import type { ChunkValidationError, StoreError } from "../domain/errors.js"
import { IndexStore } from "../domain/ports.js"

/** Current persisted index status. */
export interface StatusResult {
  readonly chunks: number
  readonly files: number
  readonly model: string
  readonly lastIndex: number
  readonly totalLines: number
  readonly byteSize: number
  readonly validationErrors: readonly ChunkValidationError[]
  readonly diagnostics: readonly IndexDiagnostic[]
}

/** Use case: get index statistics. Depends on IndexStore via Effect tag. */
export class GetStatus extends Context.Service<
  GetStatus,
  {
    readonly getStatus: Effect.Effect<StatusResult, StoreError>
  }
>()("GetStatus") {}

const make = Effect.gen(function* () {
  const store = yield* IndexStore

  const getStatus = store.getStatus

  return { getStatus } as const
})

export const GetStatusLive = Layer.effect(GetStatus, make)
