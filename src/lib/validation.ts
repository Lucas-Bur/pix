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

export const decodeWithErrors = <A, R>(
  schema: Schema.Schema<A, any, R>,
  value: unknown,
): Effect.Effect<A, SchemaDecodeError, R> =>
  Schema.decodeUnknown(schema)(value).pipe(
    Effect.mapError((error: ParseResult.ParseError) => ({
      message: formatSchemaMessage(error),
      errors: formatSchemaErrors(error),
    })),
  )
