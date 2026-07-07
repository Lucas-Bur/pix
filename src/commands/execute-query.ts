import { Effect, Option } from "effect"

import { QueryProject } from "../application/query-project.js"
import { Clipboard, Display } from "../domain/ports.js"
import type { SearchOptions, SearchResponse } from "../domain/ports.js"
import { clampTopK } from "../lib/config/validation.js"
import { applyCharBudget, formatResult, toJsonOutput } from "../lib/formatting/search-output.js"
import type { QueryCommandInput } from "./query-options.js"

const MIN_TOP_K = 1
const MAX_TOP_K = 100

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

const formatClipboardResults = (
  results: readonly SearchResponse["results"][number][],
  noContent: boolean,
): string => results.map((result, i) => formatResult(result, i + 1, noContent)).join("\n\n")

/** Execute a query from parsed CLI input. Shared by `pix query` and alias runners. */
export const executeQuery = ({
  queryText,
  top,
  contextLines,
  ignorePath,
  onlyPath,
  maxCharacters,
  noContent,
  copy,
}: QueryCommandInput) =>
  Effect.gen(function* () {
    const d = yield* Display

    const {
      options: searchOptions,
      clamped,
      rawValue,
    } = buildSearchOptions(top, ignorePath, onlyPath)

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

    if (copy && finalResults.length > 0) {
      const clipboard = yield* Clipboard
      yield* clipboard.copy(formatClipboardResults(finalResults, noContent))
      yield* d.log(`Copied ${finalResults.length} result(s) to clipboard`, "success")
    }

    yield* renderResults(d, { ...searchResponse, results: finalResults }, contextLines, noContent)
  })
