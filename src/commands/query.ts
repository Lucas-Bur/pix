import { Args, Command, Options } from "@effect/cli"
import { Effect, Option } from "effect"

import { QueryProject } from "../application/query-project.js"
import { Display } from "../domain/ports.js"
import type { SearchOptions, SearchResponse } from "../domain/ports.js"
import { clampTopK } from "../lib/config/validation.js"
import { reportError } from "../lib/errors/error-format.js"
import {
  applyCharBudget,
  formatLocation,
  formatResult,
  toJsonOutput,
} from "../lib/formatting/search-output.js"

const DEFAULT_TOP_K = 5
const DEFAULT_CONTEXT_LINES = 0
const MIN_TOP_K = 1
const MAX_TOP_K = 100

/** Build SearchOptions from parsed CLI args, clamping topK. */
const buildSearchOptions = (
  top: Option.Option<number>,
  ignorePath: readonly string[],
  onlyPath: readonly string[],
): { options: SearchOptions; clamped: boolean; rawValue: number } => {
  const rawValue = Option.getOrElse(top, () => DEFAULT_TOP_K)
  const clamped = clampTopK(rawValue, MIN_TOP_K, MAX_TOP_K)
  return {
    options: {
      topK: clamped.value,
      ...(ignorePath.length > 0 && { ignorePaths: [...ignorePath] }),
      ...(onlyPath.length > 0 && { onlyPaths: [...onlyPath] }),
    },
    clamped: clamped.clamped,
    rawValue,
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
      for (const result of results) {
        yield* d.text(noContent ? formatLocation(result) : formatResult(result))
      }
    }
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
      const {
        options: searchOptions,
        clamped,
        rawValue,
      } = buildSearchOptions(top, ignorePath, onlyPath)

      if (clamped) {
        yield* d.log(`topK clamped from ${rawValue} to ${searchOptions.topK}`, "warn")
      }

      const searchResponse = yield* d.spinner(
        "Searching...",
        QueryProject.queryProject(queryText, searchOptions),
      )

      const finalResults = noContent
        ? searchResponse.results
        : applyCharBudget(searchResponse.results, Option.getOrUndefined(maxCharacters)).results

      yield* renderResults(d, { ...searchResponse, results: finalResults }, ctxLines, noContent)
    }).pipe(
      Effect.catchTags({
        ModelLoadError: reportError,
        InferenceError: reportError,
        DiskFullError: reportError,
        StoreError: reportError,
        NoIndexError: reportError,
        ModelMismatchError: reportError,
        ConfigHealError: reportError,
        ConfigError: reportError,
        ConfigNotFoundError: reportError,
        ConfigMalformedError: reportError,
        ConfigValidationError: reportError,
      }),
    ),
)
