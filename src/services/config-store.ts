import { Effect, Layer, Option, Schema } from "effect"
import { FileSystem } from "effect/FileSystem"

import { ConfigSchema, DEFAULT_CONFIG } from "../domain/config.js"
import type { Config } from "../domain/config.js"
import {
  ConfigError,
  ConfigHealError,
  ConfigMalformedError,
  ConfigNotFoundError,
  ConfigValidationError,
  DiskFullError,
} from "../domain/errors.js"
import { ConfigStore, ModelRegistry, type HealConflict } from "../domain/ports.js"
import { decodeObjectWithErrors } from "../lib/config/validation.js"
import { deepMerge } from "../lib/deep-merge.js"
import { withConfigError } from "../lib/errors/fs-error.js"
import { isPlatformReason } from "../lib/errors/platform-error.js"
import { ModelRegistryLive } from "./models.js"

const CONFIG_DIR = ".pix"
const CONFIG_PATH = `${CONFIG_DIR}/config.json`

/** Parse JSON string, deep-merge with DEFAULT_CONFIG, validate against ConfigSchema. */
const structurallyHeal = (
  content: string,
): Effect.Effect<Config, ConfigMalformedError | ConfigValidationError> =>
  Effect.gen(function* () {
    const parsed = yield* Schema.decodeEffect(
      Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown)),
    )(content).pipe(
      Effect.mapError(
        (cause) =>
          new ConfigMalformedError({
            message: "Invalid JSON in config.json",
            path: CONFIG_PATH,
            cause,
          }),
      ),
    )

    const merged = deepMerge(DEFAULT_CONFIG, parsed)
    return yield* decodeObjectWithErrors(ConfigSchema, merged)
  })

/** Check coupled rules (model exists in registry, dtype supported by model) and collect conflicts. */
const validateCoupled = (
  config: Config,
  registry: typeof ModelRegistry.Service,
): Effect.Effect<{ config: Config; conflicts: ReadonlyArray<HealConflict> }> =>
  Effect.gen(function* () {
    const conflicts: HealConflict[] = []
    let healed = config

    const modelInfo = yield* registry.get(config.embedder.model)

    if (Option.isNone(modelInfo)) {
      conflicts.push({
        field: "embedder.model",
        currentValue: config.embedder.model,
        validOptions: yield* listModelIds(registry),
        reason: `Unknown model "${config.embedder.model}"`,
        healed: false,
      })
      return { config: healed, conflicts }
    }

    const info = modelInfo.value
    if (!info.dtypes.includes(config.embedder.dtype)) {
      conflicts.push({
        field: "embedder.dtype",
        currentValue: config.embedder.dtype,
        validOptions: info.dtypes as readonly string[],
        reason: `Model "${config.embedder.model}" does not support dtype "${config.embedder.dtype}"`,
        healed: true,
        healedValue: info.defaultDtype,
      })
      healed = {
        ...healed,
        embedder: { ...healed.embedder, dtype: info.defaultDtype },
      }
    }

    return { config: healed, conflicts }
  })

/** List all model IDs in the registry (for error messages and conflict options). */
const listModelIds = (registry: typeof ModelRegistry.Service): Effect.Effect<readonly string[]> =>
  registry.list

/** Read file, structural heal, coupled validation. Returns config + all conflicts. */
const readAndHeal = (
  fs: typeof FileSystem.Service,
  registry: typeof ModelRegistry.Service,
): Effect.Effect<
  { config: Config; conflicts: ReadonlyArray<HealConflict> },
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
    const structurallyHealed = yield* structurallyHeal(content)
    return yield* validateCoupled(structurallyHealed, registry)
  })

const make = Effect.gen(function* () {
  const fs = yield* FileSystem
  const registry = yield* ModelRegistry

  const writeConfig = (config: Config): Effect.Effect<void, ConfigError | DiskFullError> =>
    Effect.gen(function* () {
      const encodeJson = Schema.fromJsonString(ConfigSchema)
      const configJson = yield* Schema.encodeEffect(encodeJson)(config).pipe(
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

  const readConfig = readAndHeal(fs, registry).pipe(
    Effect.flatMap(({ config, conflicts }) => {
      const unhealed = conflicts.filter((c) => !c.healed)
      if (unhealed.length > 0) {
        return Effect.fail(
          new ConfigHealError({
            conflicts: unhealed.map((c) => ({
              field: c.field,
              currentValue: c.currentValue,
              validOptions: c.validOptions,
              reason: c.reason,
            })),
          }),
        )
      }
      return Effect.succeed(config)
    }),
  )

  const healConfig = readAndHeal(fs, registry)

  const configExists = fs.exists(CONFIG_PATH).pipe(Effect.orElseSucceed(() => false))

  return { writeConfig, readConfig, healConfig, configExists } as const
})

export const ConfigStoreLive = Layer.provideMerge(
  Layer.effect(ConfigStore, make),
  ModelRegistryLive,
)
