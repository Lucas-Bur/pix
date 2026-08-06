import { SqliteMigrator } from "@effect/sql-sqlite-node"
import { FileSystem } from "effect"
import { Migrator } from "effect/unstable/sql"

import initialIndex from "./migrations/001_initial-index.js"
import sparseIndex from "./migrations/002_sparse-index.js"
import sparseEmbeddingCache from "./migrations/003_sparse-embedding-cache.js"
import indexDiagnostics from "./migrations/004-index-diagnostics.js"
import indexChunkTokens from "./migrations/005-index-chunk-tokens.js"

const migrations = {
  "001_initial_index": initialIndex,
  "002_sparse_index": sparseIndex,
  "003_sparse_embedding_cache": sparseEmbeddingCache,
  "004_index_diagnostics": indexDiagnostics,
  "005_index_chunk_tokens": indexChunkTokens,
} as const

const loader: Migrator.Loader<FileSystem.FileSystem> = SqliteMigrator.fromRecord(migrations)

/** Layer that applies all pending index database migrations. */
export const IndexMigratorLive = SqliteMigrator.layer({
  loader,
  table: "pix_migrations",
})
