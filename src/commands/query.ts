import { Effect, Option } from "effect"
import { Argument, Command, Flag } from "effect/unstable/cli"

import { QueryProject } from "../application/query-project.js"
import { Display } from "../domain/ports.js"
import type { SearchOptions, SearchResponse } from "../domain/ports.js"
import { clampTopK } from "../lib/config/validation.js"
import { reportError } from "../lib/errors/error-format.js"
import { applyCharBudget, formatResult, toJsonOutput } from "../lib/formatting/search-output.js"

const DEFAULT_TOP_K = 5
const DEFAULT_CONTEXT_LINES = 0
const MIN_TOP_K = 1
const MAX_TOP_K = 100

/** Build SearchOptions from parsed CLI args, clamping topK. */
const buildSearchOptions = (
  top: number,
  ignorePath: readonly string[],
  onlyPath: readonly string[],
): { options: SearchOptions; clamped: boolean; rawValue: number } => {
  const clamped = clampTopK(top, MIN_TOP_K, MAX_TOP_K)
  return {
    options: {
      topK: clamped.value,
      ...(ignorePath.length > 0 && { ignorePaths: [...ignorePath] }),
      ...(onlyPath.length > 0 && { onlyPaths: [...onlyPath] }),
    },
    clamped: clamped.clamped,
    rawValue: top,
  }
}

/** Render search results via Display — JSON + human-readable text. */
const renderResults = (
  d: typeof Display.Service,
  response: SearchResponse,
  ctxLines: number,
  noContent: boolean,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    const { results, validationErrors } = response

    yield* d.json({
      results: toJsonOutput(results, ctxLines, noContent),
      ...(validationErrors.length > 0 && { validationErrors }),
    })

    if (results.length === 0) {
      yield* d.log("No results found", "warn")
    } else {
      yield* Effect.forEach(results, (result, i) => d.text(formatResult(result, i + 1, noContent)))
    }
  })

/**
 * CLI command: pix query "<text>" [--top N] [--json] [--context-lines N] [--ignore-path P]
 * [--only-path P] [--max-characters N] [--no-content]
 */
export const queryCommand = Command.make(
  "query",
  {
    queryText: Argument.string("query"),
    top: Flag.integer("top").pipe(Flag.withDefault(DEFAULT_TOP_K)),
    json: Flag.boolean("json").pipe(Flag.withDefault(false)),
    contextLines: Flag.integer("context-lines").pipe(Flag.withDefault(DEFAULT_CONTEXT_LINES)),
    ignorePath: Flag.string("ignore-path").pipe(Flag.withDefault("" as const)),
    onlyPath: Flag.string("only-path").pipe(Flag.withDefault("" as const)),
    maxCharacters: Flag.integer("max-characters").pipe(Flag.optional),
    noContent: Flag.boolean("no-content").pipe(Flag.withDefault(false)),
  },
  ({ queryText, top, contextLines, ignorePath, onlyPath, maxCharacters, noContent }) =>
    Effect.gen(function* () {
      const d = yield* Display

      const {
        options: searchOptions,
        clamped,
        rawValue,
      } = buildSearchOptions(top, [ignorePath].filter(Boolean), [onlyPath].filter(Boolean))

      if (clamped) {
        yield* d.log(`topK clamped from ${rawValue} to ${searchOptions.topK}`, "warn")
      }

      const queryService = yield* QueryProject

      const searchResponse = yield* d.spinner(
        "Searching...",
        queryService.queryProject(queryText, searchOptions),
      )

      const finalResults = noContent
        ? searchResponse.results
        : applyCharBudget(searchResponse.results, Option.getOrUndefined(maxCharacters)).results

      yield* renderResults(d, { ...searchResponse, results: finalResults }, contextLines, noContent)
    }).pipe(Effect.catch(reportError)),
)
