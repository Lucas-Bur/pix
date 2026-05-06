import type { PlatformError } from "@effect/platform/Error"
import { Effect } from "effect"

import { VectorStore } from "../domain/ports.js"

/** Return type for pix status */
export interface StatusResult {
  readonly chunks: number
  readonly files: number
  readonly model: string
  readonly lastIndex: number
  readonly totalLines: number
  readonly byteSize: number
}

/** Use case: get index statistics. Depends on VectorStore via Effect tag. */
export class GetStatus extends Effect.Service<GetStatus>()("GetStatus", {
  accessors: true,
  effect: Effect.gen(function* () {
    const store = yield* VectorStore

    const getStatus = (): Effect.Effect<StatusResult, PlatformError> =>
      Effect.map(store.getStats(), (stats) => stats)

    return { getStatus }
  }),
}) {}
