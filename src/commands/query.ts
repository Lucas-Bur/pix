import { Args, Command, Options } from "@effect/cli"
import { Effect, Option } from "effect"

import { QueryProject } from "../application/query-project.js"
import { Display } from "../display/Display.js"
import type { SearchResult } from "../domain/ports.js"
import { reportError } from "../lib/error-format.js"
import { applyTokenBudget } from "../lib/format.js"

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

const toJsonOutput = (results: readonly SearchResult[], ctxLines: number) =>
  results.map((r) => ({
    score: r.score,
    file: r.file,
    startLine: r.startLine,
    endLine: r.endLine,
    text: r.text,
    ...(ctxLines > 0 && r.contextBefore && { contextBefore: r.contextBefore }),
    ...(ctxLines > 0 && r.contextAfter && { contextAfter: r.contextAfter }),
  }))

const ignorePathOption = Options.text("ignore-path").pipe(Options.repeated)
const onlyPathOption = Options.text("only-path").pipe(Options.repeated)
const maxTokensOption = Options.integer("max-tokens").pipe(Options.optional)

/**
 * CLI command: pix query "<text>" [--top N] [--json] [--context-lines N] [--ignore-path P]
 * [--only-path P] [--max-tokens N]
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
    ignorePath: ignorePathOption,
    onlyPath: onlyPathOption,
    maxTokens: maxTokensOption,
  },
  ({ queryText, top, contextLines, ignorePath, onlyPath, maxTokens }) =>
    Effect.gen(function* () {
      const d = yield* Display
      const topK = Option.getOrElse(top, () => DEFAULT_TOP_K)
      const ctxLines = Option.getOrElse(contextLines, () => DEFAULT_CONTEXT_LINES)
      const clamped = clampTopK(topK)

      const hasFilter = ignorePath.length > 0 || onlyPath.length > 0
      const searchOptions = hasFilter
        ? {
            ...(ignorePath.length > 0 && { ignorePaths: [...ignorePath] }),
            ...(onlyPath.length > 0 && { onlyPaths: [...onlyPath] }),
          }
        : undefined

      if (clamped.clamped) {
        yield* d.log(`topK clamped from ${topK} to ${clamped.value}`, "warn")
      }

      const results = yield* d.spinner(
        "Searching...",
        QueryProject.queryProject(queryText, clamped.value, searchOptions),
      )

      const maxTokenValue = Option.getOrUndefined(maxTokens)
      const { results: budgetedResults } = applyTokenBudget(results, maxTokenValue)

      yield* d.json(toJsonOutput(budgetedResults, ctxLines))

      if (budgetedResults.length === 0) {
        yield* d.log("No results found", "warn")
      } else {
        for (const result of budgetedResults) {
          yield* d.text(formatResult(result))
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
