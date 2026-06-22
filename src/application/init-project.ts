import { Effect } from "effect"

import type { Config } from "../domain/config.js"
import { DEFAULT_CONFIG } from "../domain/config.js"
import { ConfigError } from "../domain/errors.js"
import type { DiskFullError } from "../domain/errors.js"
import { ConfigStore } from "../domain/ports.js"

/** Result of initializing a project. */
interface InitResult {
  readonly success: true
  readonly config: Config
}

/**
 * Use case: initialize a pix project by writing config. Depends on ConfigStore via Effect tag.
 * Accepts optional model override; falls back to DEFAULT_CONFIG.embedder.model.
 */
export class InitProject extends Effect.Service<InitProject>()("InitProject", {
  accessors: true,
  effect: Effect.gen(function* () {
    const store = yield* ConfigStore

    const init = (model?: string): Effect.Effect<InitResult, ConfigError | DiskFullError> => {
      const config: Config = model
        ? { ...DEFAULT_CONFIG, embedder: { ...DEFAULT_CONFIG.embedder, model } }
        : DEFAULT_CONFIG
      return store.writeConfig(config).pipe(Effect.as({ success: true as const, config }))
    }

    return { init }
  }),
}) {}
