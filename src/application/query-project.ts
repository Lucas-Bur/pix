import { Effect } from "effect"
import ignore from "ignore"

import type { DtypeMismatchError, VectorDecodeError } from "../domain/dtype.js"
import type { AllEmbedderErrors, AllStoreErrors, NoIndexError } from "../domain/errors.js"
import { Embedder, IndexStore } from "../domain/ports.js"
import type {
  ChunkEntry,
  RankedChunk,
  SearchOptions,
  SearchResponse,
  SearchResult,
} from "../domain/ports.js"
import { buildChunkValidationErrors } from "../lib/config/validation.js"
import { rankBm25 } from "../lib/retrieval/bm25.js"
import { rankDense } from "../lib/retrieval/dense.js"
import { rrfFuse } from "../lib/retrieval/rrf.js"
import { tokenize } from "../lib/retrieval/tokenize.js"

type PathFilter = { ignores(path: string): boolean }

const buildIgnoreFilter = (patterns: readonly string[]): PathFilter => {
  const ig = ignore().add([...patterns])
  return { ignores: (p: string) => ig.ignores(p) }
}

const makeIgnoreFilter = (patterns: readonly string[]): PathFilter | null =>
  patterns.length > 0 ? buildIgnoreFilter(patterns) : null

const makeOnlyFilter = (patterns: readonly string[]): PathFilter | null =>
  patterns.length > 0 ? buildIgnoreFilter(patterns) : null

export const filterResults = (
  results: readonly SearchResult[],
  options: SearchOptions | undefined,
): SearchResult[] => {
  const ignoreFilter = makeIgnoreFilter(options?.ignorePaths ?? [])
  const onlyFilter = makeOnlyFilter(options?.onlyPaths ?? [])
  if (!ignoreFilter && !onlyFilter) return [...results]
  return results.filter((r) => {
    if (ignoreFilter && ignoreFilter.ignores(r.file)) return false
    if (onlyFilter && !onlyFilter.ignores(r.file)) return false
    return true
  })
}

const SHORT_QUERY_MAX = 2
const LONG_QUERY_MIN = 8

const routeQuery = (queryText: string): { bm25: number; dense: number } => {
  const count = tokenize(queryText).length
  if (count <= SHORT_QUERY_MAX) return { bm25: 1.5, dense: 0.5 }
  if (count >= LONG_QUERY_MIN) return { bm25: 0.5, dense: 1.5 }
  return { bm25: 1.0, dense: 1.0 }
}

const fuseResults = (
  lexical: readonly RankedChunk[],
  dense: readonly RankedChunk[],
  weights: { bm25: number; dense: number },
  entryMap: Map<number, ChunkEntry>,
): SearchResult[] => {
  const fused = rrfFuse([lexical, dense], [weights.bm25, weights.dense])
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
    const store = yield* IndexStore

    const queryProject = (
      queryText: string,
      options?: SearchOptions,
    ): Effect.Effect<
      SearchResponse,
      AllEmbedderErrors | AllStoreErrors | NoIndexError | DtypeMismatchError | VectorDecodeError
    > =>
      Effect.gen(function* () {
        const { entries, bm25Index, malformedLines } = yield* store.loadSearchData()
        if (entries.length === 0) {
          return {
            results: [],
            validationErrors: buildChunkValidationErrors(malformedLines),
          }
        }
        const embedding = yield* embedder.embed(queryText)

        const lexicalRanks = rankBm25(queryText, bm25Index)
        const denseRanks = rankDense(embedding.vector, entries)

        const entryMap = new Map(entries.map((e) => [e.index, e]))
        const results = fuseResults(lexicalRanks, denseRanks, routeQuery(queryText), entryMap)
        const filtered = filterResults(results, options)

        const topK = options?.topK
        const finalResults =
          topK != null
            ? filtered.slice(0, Math.max(0, Math.min(Math.floor(topK), filtered.length)))
            : filtered

        return {
          results: finalResults,
          validationErrors: buildChunkValidationErrors(malformedLines),
        }
      })

    return { queryProject }
  }),
}) {}
