import { Effect } from "effect"

import type { DtypeMismatchError, VectorDecodeError } from "../domain/dtype.js"
import type { AllEmbedderErrors, AllStoreErrors, NoIndexError } from "../domain/errors.js"
import { Embedder, VectorStore } from "../domain/ports.js"
import type {
  Bm25Index,
  ChunkEntry,
  RankedChunk,
  SearchOptions,
  SearchResponse,
  SearchResult,
} from "../domain/ports.js"
import { rankBm25 } from "../lib/bm25.js"
import { rankDense } from "../lib/dense.js"
import { makeIgnoreFilter, makeOnlyFilter } from "../lib/path-filter.js"
import { bm25Weight, denseWeight } from "../lib/query-router.js"
import { rrfFuse } from "../lib/rrf.js"

const bm25Rank = (queryText: string, index: Bm25Index): RankedChunk[] => rankBm25(queryText, index)

const fuseResults = (
  lexical: readonly RankedChunk[],
  dense: readonly RankedChunk[],
  entryMap: Map<number, ChunkEntry>,
  queryText: string,
): SearchResult[] => {
  const fused = rrfFuse([lexical, dense], [bm25Weight(queryText), denseWeight(queryText)])
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
        const denseEntries = entries.map((e) => ({ index: e.index, vector: e.vector }))

        const [lexicalRanks, denseRanks] = yield* Effect.all(
          [
            Effect.sync(() => bm25Rank(queryText, bm25Index)),
            Effect.sync(() => rankDense(embedding.vector, denseEntries)),
          ],
          { concurrency: "unbounded" },
        )

        const entryMap = new Map(entries.map((e) => [e.index, e]))
        const results = fuseResults(lexicalRanks, denseRanks, entryMap, queryText)

        const ignoreFilter = makeIgnoreFilter(options?.ignorePaths ?? [])
        const onlyFilter = makeOnlyFilter(options?.onlyPaths ?? [])
        const filtered =
          ignoreFilter || onlyFilter
            ? results.filter((r) => {
                if (ignoreFilter && ignoreFilter.ignores(r.file)) return false
                if (onlyFilter && !onlyFilter.ignores(r.file)) return false
                return true
              })
            : results

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
