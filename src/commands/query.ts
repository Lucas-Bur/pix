import { Args, Command, Options } from "@effect/cli"
import { Effect, Option } from "effect"

import { QueryProject } from "../application/query-project.js"
import { Display } from "../display/Display.js"
import type { SearchResult } from "../domain/ports.js"
import { reportError } from "../lib/error-format.js"
import { applyCharBudget } from "../lib/format.js"

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

/** Format a result as a lightweight location reference (no text content). */
const formatLocation = (result: SearchResult): string =>
  `${result.file}:${result.startLine}-${result.endLine} (score: ${result.score.toFixed(3)})`

const toJsonOutput = (results: readonly SearchResult[], ctxLines: number, noContent = false) =>
  results.map((r) => {
    const base: Record<string, unknown> = {
      score: r.score,
      file: r.file,
      startLine: r.startLine,
      endLine: r.endLine,
    }
    if (!noContent) {
      base.text = r.text
      if (ctxLines > 0 && r.contextBefore) base.contextBefore = r.contextBefore
      if (ctxLines > 0 && r.contextAfter) base.contextAfter = r.contextAfter
    }
    return base
  })

/**
 * CLI command: pix query "<text>" [--top N] [--json] [--context-lines N] [--ignore-path P]
 * [--only-path P] [--max-characters N] [--no-content]
 */
export const queryCommand = Command.make(
  "query",
  {
    queryText: Args.text({ name: "query" }),
    top: Options.integer("top").pipe(Options.withDefault(DEFAULT_TOP_K), Options.optional),
    json: Options.boolean("json").pipe(Options.withDefault(false)),
    contextLines: Options.integer("context-lines").pipe(
      Options.withDefault(DEFAULT_CONTEXT_LINES),
      Options.optional,
    ),
    ignorePath: Options.text("ignore-path").pipe(Options.repeated),
    onlyPath: Options.text("only-path").pipe(Options.repeated),
    maxCharacters: Options.integer("max-characters").pipe(Options.optional),
    noContent: Options.boolean("no-content").pipe(Options.withDefault(false)),
  },
  ({ queryText, top, contextLines, ignorePath, onlyPath, maxCharacters, noContent }) =>
    Effect.gen(function* () {
      const d = yield* Display
      const ctxLines = Option.getOrElse(contextLines, () => DEFAULT_CONTEXT_LINES)
      const rawTopK = Option.getOrElse(top, () => DEFAULT_TOP_K)
      const clamped = clampTopK(rawTopK)

      const searchOptions: import("../domain/ports.js").SearchOptions = {
        topK: clamped.value,
        ...(ignorePath.length > 0 && { ignorePaths: [...ignorePath] }),
        ...(onlyPath.length > 0 && { onlyPaths: [...onlyPath] }),
      }

      if (clamped.clamped) {
        yield* d.log(`topK clamped from ${rawTopK} to ${clamped.value}`, "warn")
      }

      const results = yield* d.spinner(
        "Searching...",
        QueryProject.queryProject(queryText, searchOptions),
      )

      const finalResults = noContent
        ? results
        : applyCharBudget(results, Option.getOrUndefined(maxCharacters)).results

      yield* d.json(toJsonOutput(finalResults, ctxLines, noContent))

      if (finalResults.length === 0) {
        yield* d.log("No results found", "warn")
      } else {
        for (const result of finalResults) {
          yield* d.text(noContent ? formatLocation(result) : formatResult(result))
        }
      }
    }).pipe(
      Effect.catchTags({
        ModelLoadError: reportError,
        InferenceError: reportError,
        DiskFullError: reportError,
        StoreError: reportError,
        NoIndexError: reportError,
      }),
    ),
)
