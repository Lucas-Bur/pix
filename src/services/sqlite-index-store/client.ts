import { createRequire } from "node:module"
import { dirname } from "node:path"

import { SqliteClient } from "@effect/sql-sqlite-node"
import { getPlatformPackageName } from "@sqliteai/sqlite-vector"
import { Context, Effect, Layer, Schema, String } from "effect"
import { FileSystem } from "effect/FileSystem"

import { IndexMigratorLive } from "./migrations.js"

const PlatformPackageSchema = Schema.Struct({ path: Schema.String })

/** Resolve sqlite-vector from its own package context for pnpm's isolated linker. */
const getVectorExtensionPath = (): string => {
  const projectRequire = createRequire(import.meta.url)
  const vectorRequire = createRequire(projectRequire.resolve("@sqliteai/sqlite-vector"))
  const platformPackage = vectorRequire(getPlatformPackageName())
  return Schema.decodeUnknownSync(PlatformPackageSchema)(platformPackage).path
}

const ensureDatabaseDirectory = (filename: string) =>
  filename === ":memory:"
    ? Effect.void
    : Effect.gen(function* () {
        const fs = yield* FileSystem
        yield* fs.makeDirectory(dirname(filename), { recursive: true })
      })

/** Build a migrated SQLite client with sqlite-vector loaded for one database path. */
export const sqliteIndexDatabaseLayer = (filename: string) => {
  const client = Layer.unwrap(
    ensureDatabaseDirectory(filename).pipe(
      Effect.as(
        SqliteClient.layer({
          filename,
          transformQueryNames: String.camelToSnake,
          transformResultNames: String.snakeToCamel,
        }).pipe(
          Layer.tap((context) => {
            const sqlite = Context.get(context, SqliteClient.SqliteClient)
            return sqlite.loadExtension(getVectorExtensionPath())
          }),
        ),
      ),
    ),
  )

  return IndexMigratorLive.pipe(Layer.provideMerge(client))
}

/** Production index database at `.pix/index.db`. */
export const SqliteIndexDatabaseLive = sqliteIndexDatabaseLayer(".pix/index.db")
