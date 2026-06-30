import { isAbsolute, relative } from "node:path"

import { Context, Effect, Layer } from "effect"
import ignore from "ignore"

import type { DtypeMismatchError, VectorDecodeError } from "../domain/dtype.js"
import {
  ModelMismatchError,
  NoIndexError,
  type AllConfigErrors,
  type AllEmbedderErrors,
  type AllStoreErrors,
} from "../domain/errors.js"
import { ConfigStore, Embedder, IndexStore } from "../domain/ports.js"
import type {
  ChunkEntry,
  RankedChunk,
  SearchOptions,
  SearchResponse,
  SearchResult,
} from "../domain/ports.js"
import { buildChunkValidationErrors } from "../lib/config/validation.js"
import { rankBm25 } from "../lib/retrieval/bm25.js"
import { rankCamelCase } from "../lib/retrieval/camelcase.js"
import { rankDense } from "../lib/retrieval/dense.js"
import { rankIdentity } from "../lib/retrieval/identity.js"
import { K, rrfFuse } from "../lib/retrieval/rrf.js"
import { tokenize } from "../lib/retrieval/tokenize.js"

type PathFilter = { ignores(path: string): boolean }

/** Normalize an absolute or relative path to a forward-slash relative path for the `ignore` package. */
const normalizeForIgnore = (p: string): string => {
  const normalized = p.replace(/\\/g, "/")
  if (!isAbsolute(p)) return normalized
  return relative(process.cwd(), p).replace(/\\/g, "/")
}

const buildIgnoreFilter = (patterns: readonly string[]): PathFilter => {
  const ig = ignore().add([...patterns])
  return {
    ignores: (p: string) => {
      try {
        return ig.ignores(normalizeForIgnore(p))
      } catch {
        return false
      }
    },
  }
}

const makeIgnoreFilter = (patterns: readonly string[]): PathFilter | null =>
  patterns.length > 0 ? buildIgnoreFilter(patterns) : null

const makeOnlyFilter = (patterns: readonly string[]): PathFilter | null =>
  patterns.length > 0 ? buildIgnoreFilter(patterns) : null

/**
 * Apply `--ignore` and `--only` path filters to ranked search results. Both filters are deny/allow
 * lists with gitignore-style patterns; `ignorePaths` removes matches, `onlyPaths` keeps only
 * matches. When both are active, a result must survive `ignorePaths` AND pass `onlyPaths`. When
 * neither is set, the input is returned unchanged (as a fresh array — never the same reference).
 */
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

// RRF channel weights for the four scoring paths. Tuned heuristically --
// the identity channel carries the strongest signal (exact name match),
// camelcase is a softer constituent-word match, and BM25 / Dense retain
// their existing roles. Adjust here to rebalance the fusion.
const WEIGHT_IDENTITY = 3.0
const WEIGHT_CAMELCASE = 1.5
const WEIGHT_BM25 = 1.0
const WEIGHT_DENSE = 1.0

const SHORT_QUERY_MAX = 2
const LONG_QUERY_MIN = 8

const routeQuery = (
  queryText: string,
): {
  readonly identity: number
  readonly camelcase: number
  readonly bm25: number
  readonly dense: number
} => {
  const count = tokenize(queryText).length
  // Identity and camelcase stay constant -- they're a function of the
  // query's *content*, not its *length*.
  if (count <= SHORT_QUERY_MAX) {
    return { identity: WEIGHT_IDENTITY, camelcase: WEIGHT_CAMELCASE, bm25: 1.5, dense: 0.5 }
  }
  if (count >= LONG_QUERY_MIN) {
    return { identity: WEIGHT_IDENTITY, camelcase: WEIGHT_CAMELCASE, bm25: 0.5, dense: 1.5 }
  }
  return {
    identity: WEIGHT_IDENTITY,
    camelcase: WEIGHT_CAMELCASE,
    bm25: WEIGHT_BM25,
    dense: WEIGHT_DENSE,
  }
}

const fuseResults = (
  channels: readonly { readonly list: readonly RankedChunk[]; readonly weight: number }[],
  entryMap: Map<number, ChunkEntry>,
): SearchResult[] => {
  const sumWeights = channels.reduce((a, c) => a + c.weight, 0)
  const fused = rrfFuse(
    channels.map((c) => c.list),
    channels.map((c) => c.weight),
  )
  const results: SearchResult[] = []
  for (const { chunkIndex, score } of fused) {
    const entry = entryMap.get(chunkIndex)
    if (!entry) continue
    results.push({
      score,
      rel: (score * K) / sumWeights,
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

export class QueryProject extends Context.Service<
  QueryProject,
  {
    readonly queryProject: (
      queryText: string,
      options?: SearchOptions,
    ) => Effect.Effect<
      SearchResponse,
      | AllConfigErrors
      | AllEmbedderErrors
      | AllStoreErrors
      | NoIndexError
      | DtypeMismatchError
      | VectorDecodeError
      | ModelMismatchError
    >
  }
>()("QueryProject") {}

const make = Effect.gen(function* () {
  const embedder = yield* Embedder
  const store = yield* IndexStore
  const configStore = yield* ConfigStore

  const queryProject = (
    queryText: string,
    options?: SearchOptions,
  ): Effect.Effect<
    SearchResponse,
    | AllConfigErrors
    | AllEmbedderErrors
    | AllStoreErrors
    | NoIndexError
    | DtypeMismatchError
    | VectorDecodeError
    | ModelMismatchError
  > =>
    Effect.gen(function* () {
      const status = yield* store.getStatus()
      if (status.model === "") {
        return yield* new NoIndexError({ message: "No index found. Run pix index first." })
      }
      const config = yield* configStore.readConfig()
      if (config.embedder.model !== status.model) {
        return yield* new ModelMismatchError({
          configModel: config.embedder.model,
          indexModel: status.model,
        })
      }
      const { entries, bm25Index, identifierIndex, malformedLines } = yield* store.loadSearchData()
      if (entries.length === 0) {
        return {
          results: [],
          validationErrors: buildChunkValidationErrors(malformedLines),
        }
      }
      const embedding = yield* embedder.embed(queryText)

      const lexicalRanks = rankBm25(queryText, bm25Index)
      const denseRanks = rankDense(embedding.vector, entries)
      const identityRanks = rankIdentity(queryText, identifierIndex)
      const camelcaseRanks = rankCamelCase(queryText, identifierIndex)

      const entryMap = new Map(entries.map((e) => [e.index, e]))
      const weights = routeQuery(queryText)
      // Only pass channels that produced hits -- otherwise their weight still
      // gets included in the sum that normalizes rel, and absent channels
      // would lower rel even when BM25 + Dense had strong matches.
      const channels = [
        { list: identityRanks, weight: weights.identity },
        { list: camelcaseRanks, weight: weights.camelcase },
        { list: lexicalRanks, weight: weights.bm25 },
        { list: denseRanks, weight: weights.dense },
      ].filter((channel) => channel.list.length > 0)
      const results = channels.length === 0 ? [] : fuseResults(channels, entryMap)
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

  return { queryProject } as const
})

export const QueryProjectLive = Layer.effect(QueryProject, make)
