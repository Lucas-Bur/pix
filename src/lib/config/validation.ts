import { Data, Effect, Schema } from "effect"
import * as ParseResult from "effect/ParseResult"

import { ChunkValidationError } from "../../domain/errors.js"

export interface ValidationEntry {
  readonly path: string
  readonly message: string
}

export class JsonSyntaxError extends Data.TaggedError("JsonSyntaxError")<{
  readonly message: string
  readonly errors: ReadonlyArray<ValidationEntry>
}> {}

export class SchemaValidationError extends Data.TaggedError("SchemaValidationError")<{
  readonly message: string
  readonly errors: ReadonlyArray<ValidationEntry>
}> {}

export type JsonDecodeError = JsonSyntaxError | SchemaValidationError

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

const isJsonSyntaxError = (error: ParseResult.ParseError): boolean =>
  error.issue._tag === "Transformation" && error.issue.kind === "Transformation"

/** Clamp a number to be at least `min`. Returns the clamped value. */
export const clampPositive = (value: number, min = 1): number => Math.max(min, value)

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

export const decodeJsonWithErrors = <A>(
  schema: Schema.Schema<A, any, never>,
  json: string,
): Effect.Effect<A, JsonDecodeError> =>
  Schema.decodeUnknown(Schema.parseJson(schema))(json).pipe(
    Effect.mapError((error: ParseResult.ParseError) => {
      const base = {
        message: formatSchemaMessage(error),
        errors: formatSchemaErrors(error),
      }
      return isJsonSyntaxError(error) ? new JsonSyntaxError(base) : new SchemaValidationError(base)
    }),
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
