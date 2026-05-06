import { Effect } from "effect"

import type { Config } from "../domain/config.js"
import { DEFAULT_CONFIG, ConfigError } from "../domain/config.js"
import { ConfigStore } from "../domain/ports.js"

/** Result of initializing a project. */
interface InitResult {
  readonly success: true
  readonly config: Config
}

/**
 * Use case: initialize a pix project by writing default config. Depends on ConfigStore via Effect
 * tag.
 */
export class InitProject extends Effect.Service<InitProject>()("InitProject", {
  accessors: true,
  effect: Effect.gen(function* () {
    const store = yield* ConfigStore

    const init = (): Effect.Effect<InitResult, ConfigError> =>
      Effect.gen(function* () {
        yield* store.writeConfig(DEFAULT_CONFIG)
        return { success: true, config: DEFAULT_CONFIG }
      })

    return { init }
  }),
}) {}
