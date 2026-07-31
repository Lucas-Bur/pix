import { Effect, Layer } from "effect"
import { layerNoop } from "effect/FileSystem"

import { DEFAULT_CONFIG, type Config } from "../../src/domain/config.js"
import type { EmbeddingDtype } from "../../src/domain/dtype.js"
import { ConfigStore, IndexStore } from "../../src/domain/ports.js"
import { SqliteIndexStoreBase } from "../../src/services/sqlite-index-store.js"
import { sqliteIndexDatabaseLayer } from "../../src/services/sqlite-index-store/client.js"

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

const sqliteBenchmarkIndexLayer = (model: string, dtype: EmbeddingDtype) =>
  Layer.provideMerge(
    Layer.provideMerge(
      SqliteIndexStoreBase,
      Layer.merge(
        Layer.succeed(ConfigStore, benchmarkConfigStore(benchmarkConfig(model, dtype))),
        sqliteIndexDatabaseLayer(":memory:"),
      ),
    ),
    layerNoop({}),
  )

/** Run one benchmark operation against the production SQLite index adapter in memory. */
export const withSqliteBenchmarkStore = <A, E>(
  model: string,
  dtype: EmbeddingDtype,
  effect: Effect.Effect<A, E, IndexStore>,
): Effect.Effect<A, E | Error> =>
  Effect.scoped(effect.pipe(Effect.provide(sqliteBenchmarkIndexLayer(model, dtype))))
