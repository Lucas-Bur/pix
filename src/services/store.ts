import { FileSystem } from "@effect/platform"
import { NodeFileSystem } from "@effect/platform-node"
import { Effect, Data } from "effect"

import { type Config } from "../types.ts"

/**
 * Tagged error for config read/write operations. Use with Effect's error channel for typed error
 * handling.
 */
export class ConfigError extends Data.TaggedError("ConfigError")<{
  readonly message: string
  readonly cause?: unknown
}> {}

const CONFIG_DIR = ".pix"
const CONFIG_PATH = `${CONFIG_DIR}/config.json`

/** Write config to `.pix/config.json`. Creates `.pix/` directory if it doesn't exist. */
export const writeConfig = (config: Config): Effect.Effect<void, ConfigError> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const configJson = JSON.stringify(config, null, 2)
    yield* fs.makeDirectory(CONFIG_DIR, { recursive: true })
    yield* fs.writeFileString(CONFIG_PATH, configJson)
  }).pipe(
    Effect.catchAll((cause) =>
      Effect.fail(new ConfigError({ message: "Failed to write config", cause })),
    ),
    Effect.provide(NodeFileSystem.layer),
  )

/**
 * Read config from `.pix/config.json`. Fails with ConfigError if file doesn't exist or JSON is
 * invalid.
 */
export const readConfig = (): Effect.Effect<Config, ConfigError> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const content = yield* fs.readFileString(CONFIG_PATH)
    return JSON.parse(content) as Config
  }).pipe(
    Effect.catchAll((cause) =>
      Effect.fail(new ConfigError({ message: "Failed to read config", cause })),
    ),
    Effect.provide(NodeFileSystem.layer),
  )

/** Check if config file exists. Returns false on error (e.g., file not found). */
export const configExists = (): Effect.Effect<boolean> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    return yield* fs.exists(CONFIG_PATH)
  }).pipe(
    Effect.catchAll(() => Effect.succeed(false)),
    Effect.provide(NodeFileSystem.layer),
  )
