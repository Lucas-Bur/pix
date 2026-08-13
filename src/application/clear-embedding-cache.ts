import { Context, Effect, Layer } from "effect"

import type { DiskFullError, StoreError } from "../domain/errors.js"
import { IndexStore } from "../domain/ports.js"

/** Use case for explicitly removing retained embeddings. */
export class ClearEmbeddingCache extends Context.Service<
  ClearEmbeddingCache,
  {
    readonly clear: Effect.Effect<boolean, StoreError | DiskFullError>
  }
>()("ClearEmbeddingCache") {}

const make = Effect.gen(function* () {
  const store = yield* IndexStore
  return { clear: store.clearEmbeddingCache } as const
})

export const ClearEmbeddingCacheLive = Layer.effect(ClearEmbeddingCache, make)
