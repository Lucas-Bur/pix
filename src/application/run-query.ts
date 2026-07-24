import { Effect } from "effect"

import { normalizeQueryRequest, type QueryRequest, type QueryResponse } from "../domain/query.js"
import { clampTopK } from "../lib/config/validation.js"
import { applyCharBudget } from "../lib/formatting/search-output.js"
import { IndexProject } from "./index-project.js"
import { QueryProject } from "./query-project.js"

const MIN_TOP_K = 1
const MAX_TOP_K = 100

/** Refresh the project index and execute a transport-independent query. */
export const runQuery = (input: QueryRequest) =>
  Effect.gen(function* () {
    const request = normalizeQueryRequest(input)
    const indexProject = yield* IndexProject
    const queryProject = yield* QueryProject
    const indexResult = yield* indexProject.index()
    const top = clampTopK(request.top, MIN_TOP_K, MAX_TOP_K)
    const response = yield* queryProject.queryProject(request.queryText, {
      topK: top.value,
      ...(request.ignorePath.length > 0 && { ignorePaths: request.ignorePath }),
      ...(request.onlyPath.length > 0 && { onlyPaths: request.onlyPath }),
      contextLines: request.contextLines,
      noContent: request.noContent,
    })
    const results = request.noContent
      ? response.results
      : applyCharBudget(response.results, request.maxCharacters).results

    return {
      indexRefresh: {
        kind: indexResult.refresh,
        processedFiles: indexResult.processedFiles,
        reusedFiles: indexResult.reusedFiles,
        cacheHits: indexResult.cacheHits,
        cacheMisses: indexResult.cacheMisses,
      },
      results,
      validationErrors: response.validationErrors,
      warnings: top.clamped
        ? [{ _tag: "TopKClamped" as const, requested: request.top, applied: top.value }]
        : [],
    } satisfies QueryResponse
  })
