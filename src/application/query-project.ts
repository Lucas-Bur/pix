import { Effect } from "effect"

import type { DtypeMismatchError, VectorDecodeError } from "../domain/dtype.js"
import type { AllEmbedderErrors, AllStoreErrors, NoIndexError } from "../domain/errors.js"
import { Embedder, VectorStore } from "../domain/ports.js"
import type { SearchOptions, SearchResponse, SearchResult, Scorer } from "../domain/ports.js"
import { bm25Scorer } from "../lib/bm25.js"
import { denseScorer } from "../lib/dense.js"
import { routeQuery } from "../lib/query-router.js"
import { filterResults } from "../lib/result-filter.js"
import { rrfFuse } from "../lib/rrf.js"

const fuseResults = (
  rankedLists: readonly (readonly import("../domain/ports.js").RankedChunk[])[],
  weights: { bm25: number; dense: number },
  entryMap: Map<number, import("../domain/ports.js").ChunkEntry>,
): SearchResult[] => {
  const fused = rrfFuse(rankedLists, [weights.bm25, weights.dense])
  const results: SearchResult[] = []
  for (const { chunkIndex, score } of fused) {
    const entry = entryMap.get(chunkIndex)
    if (!entry) continue
    results.push({
      score,
      file: entry.file,
      startLine: entry.startLine,
      endLine: entry.endLine,
      text: entry.text,
      contextBefore: entry.contextBefore,
      contextAfter: entry.contextAfter,
    })
  }
  return results
}

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
      AllEmbedderErrors | AllStoreErrors | NoIndexError | DtypeMismatchError | VectorDecodeError
    > =>
      Effect.gen(function* () {
        const { entries, bm25Index } = yield* store.loadSearchData()
        const embedding = yield* embedder.embed(queryText)

        const scorers: Scorer[] = [bm25Scorer(queryText, bm25Index), denseScorer(embedding.vector)]

        const rankedLists = yield* Effect.all(
          scorers.map((s) => Effect.sync(() => s.rank(entries))),
          { concurrency: "unbounded" },
        )

        const entryMap = new Map(entries.map((e) => [e.index, e]))
        const results = fuseResults(rankedLists, routeQuery(queryText), entryMap)
        const filtered = filterResults(results, options)

        const topK = options?.topK
        const finalResults =
          topK != null
            ? filtered.slice(0, Math.max(0, Math.min(Math.floor(topK), filtered.length)))
            : filtered

        return { results: finalResults, validationErrors: [] }
      })

    return { queryProject }
  }),
}) {}
