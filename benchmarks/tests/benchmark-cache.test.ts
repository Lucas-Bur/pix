import { randomUUID } from "node:crypto"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { NodeServices } from "@effect/platform-node"
import { expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { FileSystem } from "effect/FileSystem"
import { SqlClient } from "effect/unstable/sql"

import type { ChannelRankings } from "../../src/domain/retrieval.js"
import {
  loadCachedRankings,
  saveCachedRankings,
  type CachedRankingQuery,
} from "../retrieval/execution/benchmark-cache.js"
import { withSqliteBenchmarkStore } from "../retrieval/execution/sqlite-index.js"

const queries = [
  { queryKind: "searchPhrase", query: "find the cache" },
  { queryKind: "naturalQuestion", query: "where is the cache stored?" },
] as const satisfies readonly CachedRankingQuery[]

const rankings: readonly ChannelRankings[] = [
  {
    identity: [{ chunkIndex: 2, score: 1 }],
    camelcase: [],
    bm25: [{ chunkIndex: 1, score: 0.8 }],
    dense: [{ chunkIndex: 0, score: 0.7 }],
    sparse: [],
  },
  {
    identity: [],
    camelcase: [{ chunkIndex: 3, score: 1 }],
    bm25: [],
    dense: [{ chunkIndex: 4, score: 0.6 }],
    sparse: [{ chunkIndex: 5, score: 0.5 }],
  },
]

it.effect("benchmark ranking cache survives a physical SQLite reopen", () => {
  const databasePath = join(tmpdir(), `pix-benchmark-cache-${randomUUID()}.db`)
  const run = <A, E>(effect: Effect.Effect<A, E, SqlClient.SqlClient>) =>
    withSqliteBenchmarkStore("cache-test", "fp32", effect, databasePath)

  return Effect.gen(function* () {
    const fs = yield* FileSystem
    yield* Effect.addFinalizer(() =>
      Effect.forEach(
        [databasePath, `${databasePath}-shm`, `${databasePath}-wal`],
        (candidate) =>
          Effect.gen(function* () {
            if (yield* fs.exists(candidate)) yield* fs.remove(candidate)
          }),
        { discard: true },
      ).pipe(Effect.orDie),
    )

    yield* run(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* saveCachedRankings(sql, "cache-key", queries, rankings)
      }),
    )

    const loaded = yield* run(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        return yield* loadCachedRankings(sql, "cache-key", queries)
      }),
    )
    expect(loaded).toEqual(rankings)

    const stale = yield* run(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        return yield* loadCachedRankings(sql, "cache-key", [
          { ...queries[0]! },
          { queryKind: queries[1]!.queryKind, query: "changed query" },
        ])
      }),
    )
    expect(stale).toBeUndefined()
  }).pipe(Effect.provide(NodeServices.layer), Effect.scoped)
})
