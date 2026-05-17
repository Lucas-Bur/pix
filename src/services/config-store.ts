import { FileSystem } from "@effect/platform"
import { Effect, Layer, Schema } from "effect"

import { ConfigSchema } from "../domain/config.js"
import type { Config } from "../domain/config.js"
import {
  ConfigError,
  ConfigMalformedError,
  ConfigNotFoundError,
  ConfigValidationError,
  DiskFullError,
} from "../domain/errors.js"
import { ConfigStore } from "../domain/ports.js"
import { withConfigError } from "../lib/fs-error.js"
import { isPlatformReason } from "../lib/platform-error.js"
import { decodeJsonWithErrors } from "../lib/validation.js"
export { ConfigStore }

const CONFIG_DIR = ".pix"
const CONFIG_PATH = `${CONFIG_DIR}/config.json`

const make = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem

  const writeConfig = (config: Config): Effect.Effect<void, ConfigError | DiskFullError> =>
    Effect.gen(function* () {
      const encodeJson = Schema.parseJson(ConfigSchema, { space: 2 })
      const configJson = yield* Schema.encode(encodeJson)(config).pipe(
        Effect.mapError((e) => new ConfigError({ message: "Failed to encode config", cause: e })),
      )
      yield* withConfigError(
        fs.makeDirectory(CONFIG_DIR, { recursive: true }),
        "create .pix directory",
        CONFIG_DIR,
      )
      yield* withConfigError(
        fs.writeFileString(CONFIG_PATH, configJson),
        "write config.json",
        CONFIG_PATH,
      )
    })

  const readConfig = (): Effect.Effect<
    Config,
    ConfigError | ConfigNotFoundError | ConfigMalformedError | ConfigValidationError
  > =>
    Effect.gen(function* () {
      const content = yield* fs.readFileString(CONFIG_PATH).pipe(
        Effect.mapError((cause) => {
          if (isPlatformReason(cause, "NotFound")) {
            return new ConfigNotFoundError({
              message: "Config file not found. Run pix init first.",
              path: CONFIG_PATH,
              cause,
            })
          }
          return new ConfigError({ message: "Failed to read config.json", cause })
        }),
      )
      return yield* decodeJsonWithErrors(ConfigSchema, content).pipe(
        Effect.mapError((err) => {
          if (err._tag === "JsonSyntaxError") {
            return new ConfigMalformedError({
              message: "Invalid JSON in config.json",
              path: CONFIG_PATH,
              cause: err,
            })
          }
          return new ConfigValidationError({
            message: err.message,
            errors: err.errors,
          })
        }),
      )
    })

  const configExists = (): Effect.Effect<boolean> =>
    Effect.gen(function* () {
      return yield* fs.exists(CONFIG_PATH)
    }).pipe(Effect.catchAll(() => Effect.succeed(false)))

  return { writeConfig, readConfig, configExists } as const
})

export const ConfigStoreLive = Layer.effect(ConfigStore, make)
