import { Effect } from "effect"

import type { AllEmbedderErrors, AllStoreErrors, NoIndexError } from "../domain/errors.js"
import { Embedder, VectorStore } from "../domain/ports.js"
import type { SearchResult } from "../domain/ports.js"

/** Use case: semantic search over indexed code. Depends on Embedder + VectorStore via Effect tags. */
export class QueryProject extends Effect.Service<QueryProject>()("QueryProject", {
  accessors: true,
  effect: Effect.gen(function* () {
    const embedder = yield* Embedder
    const store = yield* VectorStore

    const queryProject = (
      queryText: string,
      topK: number,
    ): Effect.Effect<readonly SearchResult[], AllEmbedderErrors | AllStoreErrors | NoIndexError> =>
      embedder.embed(queryText).pipe(Effect.flatMap((embedding) => store.search(embedding, topK)))

    return { queryProject }
  }),
}) {}
