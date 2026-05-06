import { FileSystem } from "@effect/platform"
import { Effect, Layer } from "effect"

import type { Config } from "../domain/config.js"
import { ConfigError } from "../domain/config.js"
import { ConfigStore } from "../domain/ports.js"
export { ConfigStore }

const CONFIG_DIR = ".pix"
const CONFIG_PATH = `${CONFIG_DIR}/config.json`

const make = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem

  const writeConfig = (config: Config): Effect.Effect<void, ConfigError> =>
    Effect.gen(function* () {
      const configJson = JSON.stringify(config, null, 2)
      yield* fs.makeDirectory(CONFIG_DIR, { recursive: true })
      yield* fs.writeFileString(CONFIG_PATH, configJson)
    }).pipe(
      Effect.mapError(
        (cause) => new ConfigError({ message: "Failed to write config.json", cause }),
      ),
    )

  const readConfig = (): Effect.Effect<Config, ConfigError> =>
    Effect.gen(function* () {
      const content = yield* fs.readFileString(CONFIG_PATH)
      return JSON.parse(content) as Config
    }).pipe(
      Effect.mapError((cause) => new ConfigError({ message: "Failed to read config.json", cause })),
    )

  const configExists = (): Effect.Effect<boolean> =>
    Effect.gen(function* () {
      return yield* fs.exists(CONFIG_PATH)
    }).pipe(Effect.catchAll(() => Effect.succeed(false)))

  return { writeConfig, readConfig, configExists } as const
})

export const ConfigStoreLive = Layer.effect(ConfigStore, make)
