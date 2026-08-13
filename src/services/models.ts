import { Effect, Layer, Option } from "effect"

import { MODEL_REGISTRY } from "../domain/models.js"
import { ModelRegistry } from "../domain/ports.js"

/** Live adapter: wraps the static MODEL_REGISTRY. */
export const ModelRegistryLive = Layer.succeed(ModelRegistry, {
  get: (id) => Effect.succeed(Option.fromNullishOr(MODEL_REGISTRY[id])),
  list: Effect.succeed(Object.keys(MODEL_REGISTRY)),
})
