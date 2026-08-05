import { NodeServices } from "@effect/platform-node"
import { Effect, Layer } from "effect"
import { SqlClient } from "effect/unstable/sql"

import { DEFAULT_CONFIG, type Config } from "../../../src/domain/config.js"
import type { EmbeddingDtype } from "../../../src/domain/dtype.js"
import { ConfigStore, IndexStore, SparseEmbedder } from "../../../src/domain/ports.js"
import { SparseEmbedderBase } from "../../../src/services/sparse-embedder.js"
import { SqliteIndexStoreBase } from "../../../src/services/sqlite-index-store.js"
import { sqliteIndexDatabaseLayer } from "../../../src/services/sqlite-index-store/client.js"
import { ensureBenchmarkCacheTable } from "./benchmark-cache.js"

const benchmarkConfig = (model: string, dtype: EmbeddingDtype): Config => ({
  ...DEFAULT_CONFIG,
  embedder: {
    ...DEFAULT_CONFIG.embedder,
    model,
    dtype,
  },
  vectorSearch: {
    ...DEFAULT_CONFIG.vectorSearch,
    mode: "exact",
  },
})

const benchmarkConfigStore = (config: Config): typeof ConfigStore.Service => ({
  readConfig: () => Effect.succeed(config),
  healConfig: () => Effect.succeed({ config, conflicts: [] }),
  writeConfig: () => Effect.void,
  configExists: () => Effect.succeed(true),
})

const sqliteBenchmarkLayer = (model: string, dtype: EmbeddingDtype, databasePath: string) =>
  Layer.merge(SqliteIndexStoreBase, SparseEmbedderBase).pipe(
    Layer.provideMerge(
      Layer.merge(
        Layer.succeed(ConfigStore, benchmarkConfigStore(benchmarkConfig(model, dtype))),
        sqliteIndexDatabaseLayer(databasePath),
      ),
    ),
    Layer.provideMerge(NodeServices.layer),
  )

/** Run one benchmark operation against production retrieval adapters and a benchmark SQLite index. */
export const withSqliteBenchmarkStore = <A, E>(
  model: string,
  dtype: EmbeddingDtype,
  effect: Effect.Effect<A, E, IndexStore | SparseEmbedder | SqlClient.SqlClient>,
  databasePath = ":memory:",
): Effect.Effect<A, E | Error> =>
  Effect.scoped(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* ensureBenchmarkCacheTable(sql)
      return yield* effect
    }).pipe(Effect.provide(sqliteBenchmarkLayer(model, dtype, databasePath))),
  )
