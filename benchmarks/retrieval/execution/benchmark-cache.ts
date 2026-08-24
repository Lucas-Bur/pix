import path from "node:path"

import { Effect, Schema } from "effect"
import { SqlClient, SqlSchema } from "effect/unstable/sql"

import { DEFAULT_CONFIG } from "../../../src/domain/config.js"
import type { ChannelRankings } from "../../../src/domain/retrieval.js"
import { contentHash } from "../../../src/lib/content-hash.js"
import type { CorpusManifest, QueryKind } from "../corpus/manifest.js"

const CACHE_ROOT = path.resolve("benchmarks/.cache/retrieval/v1")
const CACHE_VERSION = 1
const RANKING_IMPLEMENTATION_VERSION = 1
const CACHE_BATCH_SIZE = 100

const RankedChunkSchema = Schema.Struct({
  chunkIndex: Schema.Finite,
  score: Schema.Finite,
})

const ChannelRankingsSchema = Schema.Struct({
  identity: Schema.Array(RankedChunkSchema),
  camelcase: Schema.Array(RankedChunkSchema),
  bm25: Schema.Array(RankedChunkSchema),
  dense: Schema.Array(RankedChunkSchema),
  sparse: Schema.Array(RankedChunkSchema),
})

const RankingRowSchema = Schema.Struct({
  cacheKey: Schema.String,
  queryIndex: Schema.Finite,
  queryKind: Schema.String,
  query: Schema.String,
  rankingsJson: Schema.String,
})

const asCacheError =
  (message: string) =>
  (cause: unknown): Error =>
    cause instanceof Error ? cause : new Error(message, { cause })

const selectRankingRows = (sql: SqlClient.SqlClient) => {
  const select = SqlSchema.findAll({
    Request: Schema.String,
    Result: RankingRowSchema,
    execute: (cacheKey) => sql`
      SELECT cache_key, query_index, query_kind, query, rankings_json
      FROM benchmark_channel_rankings
      WHERE cache_key = ${cacheKey}
      ORDER BY query_index
    `,
  })
  return (cacheKey: string) =>
    select(cacheKey).pipe(
      Effect.mapError(asCacheError("Could not load benchmark channel rankings")),
    )
}

export interface BenchmarkCachePaths {
  readonly cacheKey: string
  readonly databasePath: string
}

/** Stable identity for one corpus/model/index configuration. */
export const benchmarkCachePaths = (
  manifest: CorpusManifest,
  model: string,
  dims: number,
  dtype: string,
  chunkTokens = DEFAULT_CONFIG.chunkTokens,
): BenchmarkCachePaths => {
  const identity = JSON.stringify({
    cacheVersion: CACHE_VERSION,
    rankingImplementationVersion: RANKING_IMPLEMENTATION_VERSION,
    manifest: {
      id: manifest.id,
      repository: manifest.repository,
      revision: manifest.revision,
      includeRoots: manifest.includeRoots,
      excludePaths: manifest.excludePaths,
      extensions: manifest.extensions,
    },
    model,
    dims,
    dtype,
    chunk: {
      tokens: chunkTokens,
      overlap: DEFAULT_CONFIG.overlapLines,
    },
    sparse: {
      model: DEFAULT_CONFIG.sparseEmbedder.model,
      modelRevision: DEFAULT_CONFIG.sparseEmbedder.modelRevision,
      queryModel: DEFAULT_CONFIG.sparseEmbedder.queryModel,
      queryRevision: DEFAULT_CONFIG.sparseEmbedder.queryRevision,
      idfContentHash: DEFAULT_CONFIG.sparseEmbedder.idfContentHash,
    },
  })
  const cacheKey = contentHash(identity)
  return {
    cacheKey,
    databasePath: path.join(CACHE_ROOT, `${cacheKey}.db`),
  }
}

/** Create the benchmark-only table without changing production migrations. */
export const ensureBenchmarkCacheTable = (sql: SqlClient.SqlClient): Effect.Effect<void, Error> =>
  sql`
      CREATE TABLE IF NOT EXISTS benchmark_channel_rankings (
        cache_key TEXT NOT NULL,
        query_index INTEGER NOT NULL,
        query_kind TEXT NOT NULL,
        query TEXT NOT NULL,
        rankings_json TEXT NOT NULL CHECK (json_valid(rankings_json)),
        PRIMARY KEY (cache_key, query_index)
      ) STRICT
    `.pipe(
    Effect.asVoid,
    Effect.mapError((cause) =>
      cause instanceof Error
        ? cause
        : new Error("Could not create benchmark cache table", { cause }),
    ),
  )

const decodeRankings = (value: string): ChannelRankings | undefined => {
  try {
    return Schema.decodeUnknownSync(Schema.fromJsonString(ChannelRankingsSchema))(value)
  } catch {
    return undefined
  }
}

export interface CachedRankingQuery {
  readonly queryKind: QueryKind
  readonly query: string
}

/** Load a complete ranking set, rejecting partial or stale query payloads. */
export const loadCachedRankings = (
  sql: SqlClient.SqlClient,
  cacheKey: string,
  queries: readonly CachedRankingQuery[],
): Effect.Effect<readonly ChannelRankings[] | undefined, Error> =>
  Effect.gen(function* () {
    const rows = yield* selectRankingRows(sql)(cacheKey)
    if (rows.length !== queries.length) return undefined

    const rankings: ChannelRankings[] = []
    for (let index = 0; index < queries.length; index++) {
      const row = rows[index]
      const query = queries[index]
      if (
        row === undefined ||
        query === undefined ||
        row.cacheKey !== cacheKey ||
        row.queryIndex !== index ||
        row.queryKind !== query.queryKind ||
        row.query !== query.query
      )
        return undefined
      const decoded = decodeRankings(row.rankingsJson)
      if (decoded === undefined) return undefined
      rankings.push(decoded)
    }
    return rankings
  })

/** Replace one complete ranking set transactionally after a successful collection. */
export const saveCachedRankings = (
  sql: SqlClient.SqlClient,
  cacheKey: string,
  queries: readonly CachedRankingQuery[],
  rankings: readonly ChannelRankings[],
): Effect.Effect<void, Error> =>
  Effect.gen(function* () {
    if (queries.length !== rankings.length)
      return yield* Effect.fail(new Error("Benchmark ranking cache length mismatch"))

    yield* sql
      .withTransaction(
        Effect.gen(function* () {
          yield* sql`DELETE FROM benchmark_channel_rankings WHERE cache_key = ${cacheKey}`
          for (let start = 0; start < queries.length; start += CACHE_BATCH_SIZE) {
            const values = sql.join(
              ", ",
              false,
            )(
              queries.slice(start, start + CACHE_BATCH_SIZE).map((query, offset) => {
                const ranking = rankings[start + offset]
                if (ranking === undefined) throw new Error("Missing benchmark ranking cache row")
                return sql`(
                ${cacheKey},
                ${start + offset},
                ${query.queryKind},
                ${query.query},
                ${JSON.stringify(ranking)}
              )`
              }),
            )
            yield* sql`
            INSERT INTO benchmark_channel_rankings (
              cache_key, query_index, query_kind, query, rankings_json
            ) VALUES ${values}
          `
          }
        }),
      )
      .pipe(Effect.mapError(asCacheError("Could not save benchmark channel rankings")))
  })
