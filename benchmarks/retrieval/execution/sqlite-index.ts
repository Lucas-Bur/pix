import { Effect, Layer } from "effect"
import { layerNoop } from "effect/FileSystem"

import { DEFAULT_CONFIG, type Config } from "../../../src/domain/config.js"
import type { EmbeddingDtype } from "../../../src/domain/dtype.js"
import { ConfigStore, IndexStore, SparseEmbedder } from "../../../src/domain/ports.js"
import { SparseEmbedderBase } from "../../../src/services/sparse-embedder.js"
import { SqliteIndexStoreBase } from "../../../src/services/sqlite-index-store.js"
import { sqliteIndexDatabaseLayer } from "../../../src/services/sqlite-index-store/client.js"

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

const sqliteBenchmarkLayer = (model: string, dtype: EmbeddingDtype) =>
  Layer.merge(SqliteIndexStoreBase, SparseEmbedderBase).pipe(
    Layer.provideMerge(
      Layer.merge(
        Layer.succeed(ConfigStore, benchmarkConfigStore(benchmarkConfig(model, dtype))),
        sqliteIndexDatabaseLayer(":memory:"),
      ),
    ),
    Layer.provideMerge(layerNoop({})),
  )

/** Run one benchmark operation against production retrieval adapters and an in-memory index. */
export const withSqliteBenchmarkStore = <A, E>(
  model: string,
  dtype: EmbeddingDtype,
  effect: Effect.Effect<A, E, IndexStore | SparseEmbedder>,
): Effect.Effect<A, E | Error> =>
  Effect.scoped(effect.pipe(Effect.provide(sqliteBenchmarkLayer(model, dtype))))
