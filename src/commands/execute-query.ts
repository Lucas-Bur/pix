import { Effect } from "effect"

import { runQuery } from "../application/run-query.js"
import { Clipboard, Display } from "../domain/ports.js"
import type { SearchResponse } from "../domain/ports.js"
import { normalizeQueryRequest, type QueryRequest, type QueryResponse } from "../domain/query.js"
import { formatResult, toJsonOutput } from "../lib/formatting/search-output.js"

const renderResults = (
  d: typeof Display.Service,
  response: SearchResponse,
  warnings: QueryResponse["warnings"],
  ctxLines: number,
  noContent: boolean,
  indexRefresh: {
    readonly kind: "full" | "incremental" | "none"
    readonly processedFiles: number
    readonly reusedFiles: number
    readonly cacheHits: number
    readonly cacheMisses: number
  },
): Effect.Effect<void> =>
  Effect.gen(function* () {
    const { results, validationErrors } = response

    yield* d.json({
      indexRefresh,
      results: toJsonOutput(results, ctxLines, noContent),
      ...(validationErrors.length > 0 && { validationErrors }),
      ...(warnings.length > 0 && { warnings }),
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

/** Execute and present a shared query request through the CLI adapter. */
export const executeQuery = (request: QueryRequest, copy: boolean) =>
  Effect.gen(function* () {
    const d = yield* Display
    const normalized = normalizeQueryRequest(request)
    const response = yield* d.spinner("Searching...", runQuery(request))

    yield* Effect.forEach(response.warnings, (warning) =>
      d.log(`topK clamped from ${warning.requested} to ${warning.applied}`, "warn"),
    )

    if (copy && response.results.length > 0) {
      const clipboard = yield* Clipboard
      yield* clipboard.copy(formatClipboardResults(response.results, normalized.noContent))
      yield* d.log(`Copied ${response.results.length} result(s) to clipboard`, "success")
    }

    yield* renderResults(
      d,
      response,
      response.warnings,
      normalized.contextLines,
      normalized.noContent,
      response.indexRefresh,
    )
  })
