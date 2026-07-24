import { Effect } from "effect"

import type { IndexError } from "../domain/errors.js"
import { normalizeIndexRequest, type IndexRequest, type IndexResponse } from "../domain/index.js"
import { IndexProject } from "./index-project.js"

/** Refresh the project index through the shared transport-independent API. */
export const runIndex = (
  request: IndexRequest,
): Effect.Effect<IndexResponse, IndexError, IndexProject> =>
  Effect.gen(function* () {
    const indexProject = yield* IndexProject
    const result = yield* indexProject.index(normalizeIndexRequest(request))
    return result
  })
