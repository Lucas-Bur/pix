import { SqliteMigrator } from "@effect/sql-sqlite-node"
import { FileSystem } from "effect"
import { Migrator } from "effect/unstable/sql"

import initialIndex from "./migrations/001_initial-index.js"

const migrations = {
  "001_initial_index": initialIndex,
} as const

const loader: Migrator.Loader<FileSystem.FileSystem> = SqliteMigrator.fromRecord(migrations)

/** Layer that applies all pending index database migrations. */
export const IndexMigratorLive = SqliteMigrator.layer({
  loader,
  table: "pix_migrations",
})
