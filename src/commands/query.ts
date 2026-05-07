import { Command, Options } from "@effect/cli"
import { Effect, Option } from "effect"

import { QueryProject } from "../application/query-project.js"
import type { SearchResult } from "../domain/ports.js"

const DEFAULT_TOP_K = 5
const DEFAULT_CONTEXT_LINES = 0
const MIN_TOP_K = 1
const MAX_TOP_K = 100

/** Clamp topK to [MIN_TOP_K, MAX_TOP_K]. Returns the clamped value and whether clamping was applied. */
const clampTopK = (value: number): { value: number; clamped: boolean } => {
  if (value < MIN_TOP_K) return { value: MIN_TOP_K, clamped: true }
  if (value > MAX_TOP_K) return { value: MAX_TOP_K, clamped: true }
  return { value, clamped: false }
}

/** Format a single result for human-readable output */
const formatResult = (result: SearchResult): string => {
  const contextBefore = result.contextBefore ? `\n${result.contextBefore}` : ""
  const contextAfter = result.contextAfter ? `\n${result.contextAfter}` : ""
  return `${result.file}:${result.startLine}-${result.endLine} (score: ${result.score.toFixed(3)})${contextBefore}\n${result.text}${contextAfter}`
}

/** CLI command: pix query "<text>" [--top N] [--json] [--context-lines N] */
export const queryCommand = Command.make(
  "query",
  {
    queryText: Options.text("query").pipe(Options.withAlias("q")),
    top: Options.integer("top").pipe(Options.withDefault(DEFAULT_TOP_K), Options.optional),
    json: Options.boolean("json").pipe(Options.withDefault(false)),
    contextLines: Options.integer("context-lines").pipe(
      Options.withDefault(DEFAULT_CONTEXT_LINES),
      Options.optional,
    ),
  },
  ({ queryText, top, json, contextLines }) =>
    Effect.gen(function* () {
      const topK = Option.getOrElse(top, () => DEFAULT_TOP_K)
      const ctxLines = Option.getOrElse(contextLines, () => DEFAULT_CONTEXT_LINES)
      const clamped = clampTopK(topK)

      if (clamped.clamped) {
        yield* Effect.logDebug(`topK clamped from ${topK} to ${clamped.value}`)
      }

      const results = yield* QueryProject.queryProject(queryText, clamped.value)

      if (json) {
        return yield* Effect.sync(() => {
          const output = results.map((r) => ({
            score: r.score,
            file: r.file,
            startLine: r.startLine,
            endLine: r.endLine,
            text: r.text,
            ...(ctxLines > 0 && r.contextBefore && { contextBefore: r.contextBefore }),
            ...(ctxLines > 0 && r.contextAfter && { contextAfter: r.contextAfter }),
          }))
          console.log(JSON.stringify(output, null, 2))
        })
      }

      if (results.length === 0) {
        yield* Effect.logInfo("No results found")
        return
      }

      for (const result of results) {
        yield* Effect.sync(() => {
          console.log(formatResult(result))
          console.log("---")
        })
      }
    }),
)
