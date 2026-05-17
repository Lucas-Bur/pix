import { Effect } from "effect"

import type { DtypeMismatchError } from "../domain/dtype.js"
import type { AllEmbedderErrors, AllStoreErrors, NoIndexError } from "../domain/errors.js"
import { Embedder, VectorStore } from "../domain/ports.js"
import type { SearchOptions, SearchResponse } from "../domain/ports.js"

/** Use case: semantic search over indexed code. Depends on Embedder + VectorStore via Effect tags. */
export class QueryProject extends Effect.Service<QueryProject>()("QueryProject", {
  accessors: true,
  effect: Effect.gen(function* () {
    const embedder = yield* Embedder
    const store = yield* VectorStore

    const queryProject = (
      queryText: string,
      options?: SearchOptions,
    ): Effect.Effect<
      SearchResponse,
      AllEmbedderErrors | AllStoreErrors | NoIndexError | DtypeMismatchError
    > =>
      embedder
        .embed(queryText)
        .pipe(Effect.flatMap((embedding) => store.search(embedding, options)))

    return { queryProject }
  }),
}) {}
