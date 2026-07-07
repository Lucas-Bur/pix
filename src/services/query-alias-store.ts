import { Effect, Layer, Schema } from "effect"
import { FileSystem } from "effect/FileSystem"

import { AliasNotFoundError, AliasStoreError, AliasValidationError } from "../domain/errors.js"
import { QueryAliasStore } from "../domain/ports.js"
import {
  EMPTY_QUERY_ALIAS_REGISTRY,
  QueryAliasRegistrySchema,
  type QueryAlias,
  type QueryAliasOptions,
  type QueryAliasRegistry,
} from "../domain/query-alias.js"

const STORE_DIR = ".pix"
const ALIASES_PATH = `${STORE_DIR}/aliases.json`
const ALIASES_TEMP_PATH = `${ALIASES_PATH}.tmp`
const ALIAS_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*$/
const AliasRegistryJson = Schema.fromJsonString(QueryAliasRegistrySchema)

const validateName = (name: string): Effect.Effect<void, AliasValidationError> => {
  if (!ALIAS_NAME_PATTERN.test(name)) {
    return Effect.fail(
      new AliasValidationError({
        name,
        message: `Invalid alias name "${name}". Use letters, numbers, "_" or "-", starting with a letter or number.`,
      }),
    )
  }
  return Effect.void
}

const decodeRegistry = (content: string): Effect.Effect<QueryAliasRegistry, AliasStoreError> =>
  Schema.decodeUnknownEffect(AliasRegistryJson)(content).pipe(
    Effect.mapError(
      (cause) =>
        new AliasStoreError({
          path: ALIASES_PATH,
          message: "Failed to decode aliases.json",
          cause,
        }),
    ),
  )

const encodeRegistry = (registry: QueryAliasRegistry): Effect.Effect<string, AliasStoreError> =>
  Schema.encodeEffect(AliasRegistryJson)(registry).pipe(
    Effect.mapError(
      (cause) =>
        new AliasStoreError({
          path: ALIASES_PATH,
          message: "Failed to encode aliases.json",
          cause,
        }),
    ),
  )

const make = Effect.gen(function* () {
  const fs = yield* FileSystem

  const readRegistry: Effect.Effect<QueryAliasRegistry, AliasStoreError> = Effect.gen(function* () {
    const exists = yield* fs.exists(ALIASES_PATH).pipe(
      Effect.mapError(
        (cause) =>
          new AliasStoreError({
            path: ALIASES_PATH,
            message: "Failed to check aliases.json existence",
            cause,
          }),
      ),
    )
    if (!exists) return EMPTY_QUERY_ALIAS_REGISTRY
    const content = yield* fs.readFileString(ALIASES_PATH).pipe(
      Effect.mapError(
        (cause) =>
          new AliasStoreError({
            path: ALIASES_PATH,
            message: "Failed to read aliases.json",
            cause,
          }),
      ),
    )
    return yield* decodeRegistry(content)
  })

  const writeRegistry = (registry: QueryAliasRegistry): Effect.Effect<void, AliasStoreError> =>
    Effect.gen(function* () {
      const encoded = yield* encodeRegistry(registry)
      yield* fs.makeDirectory(STORE_DIR, { recursive: true }).pipe(
        Effect.mapError(
          (cause) =>
            new AliasStoreError({
              path: STORE_DIR,
              message: "Failed to create .pix directory",
              cause,
            }),
        ),
      )
      yield* fs.writeFileString(ALIASES_TEMP_PATH, encoded).pipe(
        Effect.mapError(
          (cause) =>
            new AliasStoreError({
              path: ALIASES_TEMP_PATH,
              message: "Failed to write aliases.json temp file",
              cause,
            }),
        ),
      )
      yield* fs.rename(ALIASES_TEMP_PATH, ALIASES_PATH).pipe(
        Effect.mapError(
          (cause) =>
            new AliasStoreError({
              path: ALIASES_PATH,
              message: "Failed to commit aliases.json",
              cause,
            }),
        ),
      )
    })

  const save = (
    name: string,
    queryText: string,
    options: QueryAliasOptions,
  ): Effect.Effect<QueryAlias, AliasStoreError | AliasValidationError> =>
    Effect.gen(function* () {
      yield* validateName(name)
      const registry = yield* readRegistry
      const entry = { queryText, options }
      yield* writeRegistry({ ...registry, [name]: entry })
      return { name, ...entry }
    })

  const list = (): Effect.Effect<readonly QueryAlias[], AliasStoreError> =>
    readRegistry.pipe(
      Effect.map((registry) =>
        Object.entries(registry)
          .map(([name, entry]) => ({ name, ...entry }))
          .sort((a, b) => a.name.localeCompare(b.name)),
      ),
    )

  const get = (
    name: string,
  ): Effect.Effect<QueryAlias, AliasStoreError | AliasValidationError | AliasNotFoundError> =>
    Effect.gen(function* () {
      yield* validateName(name)
      const registry = yield* readRegistry
      const entry = registry[name]
      if (entry === undefined) {
        return yield* new AliasNotFoundError({
          name,
          message: `Alias "${name}" not found.`,
        })
      }
      return { name, ...entry }
    })

  const remove = (
    name: string,
  ): Effect.Effect<void, AliasStoreError | AliasValidationError | AliasNotFoundError> =>
    Effect.gen(function* () {
      yield* validateName(name)
      const registry = yield* readRegistry
      if (registry[name] === undefined) {
        return yield* new AliasNotFoundError({
          name,
          message: `Alias "${name}" not found.`,
        })
      }
      const { [name]: _removed, ...remaining } = registry
      yield* writeRegistry(remaining)
    })

  return { save, list, get, remove } as const
})

export const QueryAliasStoreLive = Layer.effect(QueryAliasStore, make)
