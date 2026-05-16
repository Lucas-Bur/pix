import { Effect } from "effect"

import type { ChunkValidationError, StoreError } from "../domain/errors.js"
import { ConfigStore, VectorStore } from "../domain/ports.js"

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

/** Use case: get index statistics. Depends on VectorStore and ConfigStore via Effect tags. */
export class GetStatus extends Effect.Service<GetStatus>()("GetStatus", {
  accessors: true,
  effect: Effect.gen(function* () {
    const store = yield* VectorStore
    const configStore = yield* ConfigStore

    const getStatus = (): Effect.Effect<StatusResult, StoreError> =>
      Effect.gen(function* () {
        const status = yield* store.getStatus()
        const configModel = yield* configStore.readConfig().pipe(
          Effect.map((c) => c.embedder.model),
          Effect.catchAll(() => Effect.succeed(status.model)),
        )
        return { ...status, model: configModel }
      })

    return { getStatus }
  }),
}) {}
