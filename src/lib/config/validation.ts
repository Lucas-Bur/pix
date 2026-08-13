import { Effect, Schema, SchemaIssue } from "effect"

import type { Config } from "../../domain/config.js"
import { DEFAULT_CONFIG } from "../../domain/config.js"
import { ChunkValidationError, ConfigValidationError } from "../../domain/errors.js"
import type { IndexOptions } from "../../domain/ports.js"

interface ValidationEntry {
  readonly path: string
  readonly message: string
}

const mergeMessages = (messages: readonly string[]): string => {
  if (messages.length === 1) return messages[0]
  const uniq = [...new Set(messages)]
  if (uniq.every((m) => m.startsWith("Expected"))) {
    const actualMatch = uniq[0].match(/actual (.+)$/)
    const actual = actualMatch ? actualMatch[1] : ""
    const expected = uniq
      .map((m) => m.replace(/^Expected /, "").replace(/, actual .+$/, ""))
      .join(" | ")
    return `Expected ${expected}, actual ${actual}`
  }
  return uniq.join("\n")
}

const formatSchemaErrors = (error: Schema.SchemaError): ReadonlyArray<ValidationEntry> => {
  const formatter = SchemaIssue.makeFormatterStandardSchemaV1()
  const result = formatter(error.issue) as {
    issues: ReadonlyArray<{ message: string; path?: ReadonlyArray<PropertyKey> }>
  }
  const byPath = new Map<string, string[]>()
  for (const issue of result.issues) {
    const path = issue.path?.map((p) => String(p)).join(".") ?? ""
    if (!byPath.has(path)) byPath.set(path, [])
    byPath.get(path)!.push(issue.message)
  }
  return Array.from(byPath.entries()).map(([path, messages]) => ({
    path,
    message: mergeMessages(messages),
  }))
}

const formatSchemaMessage = (error: Schema.SchemaError): string => {
  const formatter = SchemaIssue.makeFormatterDefault()
  return formatter(error.issue)
}

/** Clamp a number to be at least `min`. Returns the clamped value. */
const clampPositive = (value: number, min = 1): number => Math.max(min, value)

/**
 * Decode an unknown value against a schema, converting schema-level errors into the project's
 * `ConfigValidationError` so callers see a single failure type.
 *
 * The decoder is restricted to schemas that need no services, which keeps the returned Effect
 * independent of the runtime environment.
 */
export const decodeObjectWithErrors = <A>(
  schema: Schema.Decoder<A, never>,
  value: unknown,
): Effect.Effect<A, ConfigValidationError> =>
  Schema.decodeUnknownEffect(schema)(value).pipe(
    Effect.mapError(
      (error: Schema.SchemaError) =>
        new ConfigValidationError({
          message: formatSchemaMessage(error),
          errors: formatSchemaErrors(error),
        }),
    ),
  )

export const clampTopK = (
  value: number,
  min: number,
  max: number,
): { value: number; clamped: boolean } => {
  if (!Number.isFinite(value)) return { value: min, clamped: true }
  if (value < min) return { value: min, clamped: true }
  if (value > max) return { value: max, clamped: true }
  return { value, clamped: false }
}

export const buildChunkValidationErrors = (
  malformedLines: number,
): readonly ChunkValidationError[] =>
  malformedLines > 0
    ? [
        new ChunkValidationError({
          message: `Skipped ${malformedLines} malformed persisted chunk record(s)`,
          errors: [
            {
              path: ".pix/index.db",
              message: `${malformedLines} record(s) failed schema validation`,
            },
          ],
        }),
      ]
    : []

export interface EffectiveConfig {
  readonly batchSize: number
  readonly chunkTokens: number | undefined
  readonly concurrency: number
  readonly skipExtensions: readonly string[]
  readonly ignoredPaths: readonly string[]
  readonly ignoreGitignore: boolean
}

export const mergeConfig = (opts: IndexOptions, config: Config): EffectiveConfig => {
  const batchSize = clampPositive(
    opts.batchSize ?? config.embedder.batchSize ?? DEFAULT_CONFIG.embedder.batchSize,
  )
  const concurrency = clampPositive(opts.chunkConcurrency ?? config.chunkConcurrency)
  const requestedChunkTokens = opts.chunkTokens ?? config.chunkTokens
  const chunkTokens =
    requestedChunkTokens === undefined ? undefined : clampPositive(requestedChunkTokens)
  const skipExtensions = opts.skipExtensions
    ? [...config.skipExtensions, ...opts.skipExtensions]
    : config.skipExtensions
  const ignoredPaths = opts.ignorePaths
    ? [...config.ignoredPaths, ...opts.ignorePaths]
    : config.ignoredPaths
  const ignoreGitignore = opts.ignoreGitignore ?? config.ignoreGitignore

  return { batchSize, chunkTokens, concurrency, skipExtensions, ignoredPaths, ignoreGitignore }
}
