import { Effect, Schema } from "effect"
import * as ParseResult from "effect/ParseResult"

export interface ValidationEntry {
  readonly path: string
  readonly message: string
}

export interface SchemaDecodeError {
  readonly message: string
  readonly errors: ReadonlyArray<ValidationEntry>
}

export interface JsonSyntaxError {
  readonly _tag: "JsonSyntaxError"
  readonly message: string
  readonly errors: ReadonlyArray<ValidationEntry>
}

export interface SchemaValidationError {
  readonly _tag: "SchemaValidationError"
  readonly message: string
  readonly errors: ReadonlyArray<ValidationEntry>
}

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
      return isJsonSyntaxError(error)
        ? { ...base, _tag: "JsonSyntaxError" as const }
        : { ...base, _tag: "SchemaValidationError" as const }
    }),
  )
