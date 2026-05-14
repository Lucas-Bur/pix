import { FileSystem } from "@effect/platform"
import { Effect, Layer } from "effect"

import type { Config } from "../domain/config.js"
import { ConfigError } from "../domain/config.js"
import { ConfigMalformedError, ConfigNotFoundError, DiskFullError } from "../domain/errors.js"
import { ConfigStore } from "../domain/ports.js"
export { ConfigStore }

const CONFIG_DIR = ".pix"
const CONFIG_PATH = `${CONFIG_DIR}/config.json`

const isPlatformReason = (cause: unknown, reason: string): boolean =>
  typeof cause === "object" &&
  cause !== null &&
  "reason" in cause &&
  String((cause as { reason: unknown }).reason) === reason

const make = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem

  const writeConfig = (config: Config): Effect.Effect<void, ConfigError | DiskFullError> =>
    Effect.gen(function* () {
      const configJson = JSON.stringify(config, null, 2)
      yield* fs
        .makeDirectory(CONFIG_DIR, { recursive: true })
        .pipe(
          Effect.mapError(
            (cause) => new ConfigError({ message: "Failed to create .pix directory", cause }),
          ),
        )
      yield* fs.writeFileString(CONFIG_PATH, configJson).pipe(
        Effect.mapError((cause) => {
          if (isPlatformReason(cause, "BadResource")) {
            return new DiskFullError({
              message: "Disk full: could not write config.json",
              path: CONFIG_PATH,
              cause,
            })
          }
          return new ConfigError({ message: "Failed to write config.json", cause })
        }),
      )
    })

  const readConfig = (): Effect.Effect<
    Config,
    ConfigError | ConfigNotFoundError | ConfigMalformedError
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
      return yield* Effect.try({
        try: () => JSON.parse(content) as Config,
        catch: (error) =>
          new ConfigMalformedError({
            message: "Invalid JSON in config.json",
            path: CONFIG_PATH,
            cause: error,
          }),
      })
    })

  const configExists = (): Effect.Effect<boolean> =>
    Effect.gen(function* () {
      return yield* fs.exists(CONFIG_PATH)
    }).pipe(Effect.catchAll(() => Effect.succeed(false)))

  return { writeConfig, readConfig, configExists } as const
})

export const ConfigStoreLive = Layer.effect(ConfigStore, make)
