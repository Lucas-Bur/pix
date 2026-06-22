import { Effect, Schema } from "effect"
import * as ParseResult from "effect/ParseResult"

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

const formatSchemaErrors = (error: ParseResult.ParseError): ReadonlyArray<ValidationEntry> => {
  const issues = ParseResult.ArrayFormatter.formatErrorSync(error)
  const byPath = new Map<string, string[]>()
  for (const issue of issues) {
    const path = issue.path.join(".")
    if (!byPath.has(path)) byPath.set(path, [])
    byPath.get(path)!.push(issue.message)
  }
  return Array.from(byPath.entries()).map(([path, messages]) => ({
    path,
    message: mergeMessages(messages),
  }))
}

const formatSchemaMessage = (error: ParseResult.ParseError): string =>
  ParseResult.TreeFormatter.formatErrorSync(error)

/** Clamp a number to be at least `min`. Returns the clamped value. */
const clampPositive = (value: number, min = 1): number => Math.max(min, value)

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

/** Decode an already-parsed object against a schema, returning ConfigValidationError on failure. */
export const decodeObjectWithErrors = <A>(
  schema: Schema.Schema<A, any, never>,
  value: unknown,
): Effect.Effect<A, ConfigValidationError> =>
  Schema.decodeUnknown(schema)(value).pipe(
    Effect.mapError(
      (error: ParseResult.ParseError) =>
        new ConfigValidationError({
          message: formatSchemaMessage(error),
          errors: formatSchemaErrors(error),
        }),
    ),
  )

export const buildChunkValidationErrors = (
  malformedLines: number,
): readonly ChunkValidationError[] =>
  malformedLines > 0
    ? [
        new ChunkValidationError({
          message: `Skipped ${malformedLines} malformed chunk line(s) in chunks.jsonl`,
          errors: [
            { path: "chunks.jsonl", message: `${malformedLines} line(s) failed schema validation` },
          ],
        }),
      ]
    : []

export interface EffectiveConfig {
  readonly batchSize: number
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
  const skipExtensions = opts.skipExtensions
    ? [...config.skipExtensions, ...opts.skipExtensions]
    : config.skipExtensions
  const ignoredPaths = opts.ignorePaths
    ? [...config.ignoredPaths, ...opts.ignorePaths]
    : config.ignoredPaths
  const ignoreGitignore = opts.ignoreGitignore ?? config.ignoreGitignore

  return { batchSize, concurrency, skipExtensions, ignoredPaths, ignoreGitignore }
}
