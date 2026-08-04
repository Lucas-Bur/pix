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
import { ConfigStore, Embedder, IndexStore, SparseEmbedder } from "../domain/ports.js"
import type { ChunkMetadata, SearchOptions, SearchResponse, SearchResult } from "../domain/ports.js"
import {
  type EvidenceRouterConfig,
  resolveProductionProfile,
  type ChannelRankings,
} from "../domain/retrieval.js"
import { buildChunkValidationErrors } from "../lib/config/validation.js"
import { rankBm25 } from "../lib/retrieval/bm25.js"
import { rankCamelCase } from "../lib/retrieval/camelcase.js"
import {
  buildQueryTermCoverage,
  buildRoutingEvidence,
  routeWithEvidence,
  type RoutingEvidence,
} from "../lib/retrieval/evidence-router.js"
import { fuseRankings } from "../lib/retrieval/fusion.js"
import { rankIdentity } from "../lib/retrieval/identity.js"
import { K } from "../lib/retrieval/rrf.js"

type PathFilter = { ignores(path: string): boolean }

interface RankedResult extends SearchResult {
  readonly startOffset: number
  readonly endOffset: number
  readonly contentHash: string
}

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
export const filterResults = <T extends Pick<SearchResult, "file">>(
  results: readonly T[],
  options: SearchOptions | undefined,
): T[] => {
  const ignoreFilter = makeIgnoreFilter(options?.ignorePaths ?? [])
  const onlyFilter = makeOnlyFilter(options?.onlyPaths ?? [])
  if (!ignoreFilter && !onlyFilter) return [...results]
  return results.filter((r) => {
    if (ignoreFilter && ignoreFilter.ignores(r.file)) return false
    if (onlyFilter && !onlyFilter.ignores(r.file)) return false
    return true
  })
}

const fuseResults = (
  rankings: ChannelRankings,
  evidence: RoutingEvidence,
  config: EvidenceRouterConfig,
  entryMap: Map<number, ChunkMetadata>,
): RankedResult[] => {
  const weights = routeWithEvidence(evidence, config)
  const sumWeights =
    (rankings.identity.length > 0 ? weights.identity : 0) +
    (rankings.camelcase.length > 0 ? weights.camelcase : 0) +
    (rankings.bm25.length > 0 ? weights.bm25 : 0) +
    (rankings.dense.length > 0 ? weights.dense : 0) +
    (rankings.sparse.length > 0 ? weights.sparse : 0)
  const fused = fuseRankings(config.fusion, rankings, weights, config.candidateDepth)
  const scoreScale = config.fusion === "rrf" ? K : 1
  const results: RankedResult[] = []
  for (const { chunkIndex, score } of fused) {
    const entry = entryMap.get(chunkIndex)
    if (!entry) continue
    results.push({
      score,
      rel: sumWeights === 0 ? 0 : (score * scoreScale) / sumWeights,
      file: entry.file,
      startLine: entry.startLine,
      endLine: entry.endLine,
      startOffset: entry.startOffset,
      endOffset: entry.endOffset,
      contentHash: entry.contentHash,
      text: null,
      contextBefore: null,
      contextAfter: null,
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
  const sparseEmbedder = yield* SparseEmbedder
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
      const [embedding, sparseQuery] = yield* Effect.all(
        [embedder.embed(queryText), sparseEmbedder.tokenizeQuery(queryText)],
        { concurrency: 2 },
      )

      const lexicalRanks = rankBm25(queryText, bm25Index)
      const [denseRanks, sparseRanks] = yield* Effect.all(
        [store.searchDense(embedding), store.searchSparse(sparseQuery)],
        { concurrency: 2 },
      )
      const identityRanks = rankIdentity(queryText, identifierIndex)
      const camelcaseRanks = rankCamelCase(queryText, identifierIndex)

      const entryMap = new Map(entries.map((e) => [e.index, e]))
      // Only pass channels that produced hits -- otherwise their weight still
      // gets included in the sum that normalizes rel, and absent channels
      // would lower rel even when BM25 + Dense had strong matches.
      const rankings = {
        identity: identityRanks,
        camelcase: camelcaseRanks,
        bm25: lexicalRanks,
        dense: denseRanks,
        sparse: sparseRanks,
      }
      const profile = resolveProductionProfile(options?.profile)
      const evidence = buildRoutingEvidence(
        queryText,
        rankings,
        buildQueryTermCoverage(queryText, bm25Index, identifierIndex),
      )
      const results = Object.values(rankings).some((list) => list.length > 0)
        ? fuseResults(rankings, evidence, profile.config, entryMap)
        : []
      const filtered = filterResults(results, options)

      const topK = options?.topK
      const finalResults =
        topK != null
          ? filtered.slice(0, Math.max(0, Math.min(Math.floor(topK), filtered.length)))
          : filtered

      const hydratedResults = options?.noContent
        ? finalResults
        : yield* Effect.forEach(finalResults, (result) =>
            store
              .loadSource({
                file: result.file,
                startLine: result.startLine,
                endLine: result.endLine,
                startOffset: result.startOffset,
                endOffset: result.endOffset,
                contentHash: result.contentHash,
                contextLines: options?.contextLines ?? 0,
              })
              .pipe(Effect.map((source) => ({ ...result, ...source }))),
          )

      return {
        results: hydratedResults,
        validationErrors: buildChunkValidationErrors(malformedLines),
      }
    })

  return { queryProject } as const
})

export const QueryProjectLive = Layer.effect(QueryProject, make)
