import { randomUUID } from "node:crypto"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { NodeServices } from "@effect/platform-node"
import { SqliteClient } from "@effect/sql-sqlite-node"
import { expect, it } from "@effect/vitest"
import { Effect, Layer, Schema } from "effect"
import { FileSystem } from "effect/FileSystem"
import { SqlClient } from "effect/unstable/sql"

import { sqliteIndexDatabaseLayer } from "./sqlite-index-store/client.js"
import indexChunkTokens from "./sqlite-index-store/migrations/005-index-chunk-tokens.js"
import { Float32ArrayFromBlob } from "./sqlite-index-store/schema.js"

/**
 * Low-level SQLite migration and schema coverage. This suite is an explicit exception to the
 * public-interface-only rule because PRAGMA and raw SQL are required to verify the schema itself.
 */

const databaseLayer = Layer.provideMerge(sqliteIndexDatabaseLayer(":memory:"), NodeServices.layer)
const migrationLayer = Layer.provideMerge(
  SqliteClient.layer({ filename: ":memory:" }),
  NodeServices.layer,
)

it.effect("migration 005 backfills chunk tokens for existing index metadata", () =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    yield* sql`CREATE TABLE index_meta (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      model TEXT NOT NULL,
      dims INTEGER NOT NULL,
      dtype TEXT NOT NULL,
      last_index REAL NOT NULL,
      quantized INTEGER NOT NULL DEFAULT 0
    ) STRICT`
    yield* sql`
      INSERT INTO index_meta (id, model, dims, dtype, last_index)
      VALUES (1, 'legacy-model', 384, 'fp32', 1)
    `

    yield* indexChunkTokens

    const rows = yield* sql<{ readonly chunkTokens: number }>`
      SELECT chunk_tokens AS chunkTokens FROM index_meta WHERE id = 1
    `
    expect(rows).toEqual([{ chunkTokens: 512 }])
  }).pipe(Effect.provide(migrationLayer), Effect.scoped),
)

it.effect("loads sqlite-vector and applies index migrations", () =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const version = yield* sql<{ readonly version: string }>`SELECT vector_version() AS version`
    const tables = yield* sql<{ readonly name: string }>`
      SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name
    `
    const metaColumns = yield* sql<{
      readonly name: string
      readonly notnull: number
    }>`PRAGMA table_info(index_meta)`

    expect(version[0]?.version).toBe("1.0.0")
    expect(tables.map(({ name }) => name)).toEqual(
      expect.arrayContaining([
        "chunks",
        "embedding_cache",
        "files",
        "index_meta",
        "pix_migrations",
        "retrieval_indexes",
      ]),
    )
    expect(metaColumns.map(({ name }) => name)).toEqual(
      expect.arrayContaining(["diagnostics", "chunk_tokens"]),
    )
    expect(metaColumns.find(({ name }) => name === "chunk_tokens")?.notnull).toBe(1)
  }).pipe(Effect.provide(databaseLayer), Effect.scoped),
)

it.effect("enforces strict index invariants in SQLite", () =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const tables = yield* sql<{ readonly name: string; readonly strict: number }>`PRAGMA table_list`
    const managedTables = tables.filter(({ name }) =>
      ["chunks", "embedding_cache", "files", "index_meta", "retrieval_indexes"].includes(name),
    )
    const chunkIndexes = yield* sql<{
      readonly name: string
      readonly unique: number
    }>`PRAGMA index_list(chunks)`

    expect(managedTables).toHaveLength(5)
    expect(managedTables.every(({ strict }) => strict === 1)).toBe(true)
    expect(chunkIndexes.some(({ unique }) => unique === 1)).toBe(true)

    const fractionalMtime = yield* Effect.result(
      sql`
        INSERT INTO files (file, mtime_ms, size, content_hash)
        VALUES ('fractional.ts', 1.5, 1, 'hash')
      `,
    )
    const invalidJson = yield* Effect.result(
      sql`
        INSERT INTO retrieval_indexes (id, bm25_json, identifier_json)
        VALUES (1, 'not-json', '{}')
      `,
    )
    expect(fractionalMtime._tag).toBe("Failure")
    expect(invalidJson._tag).toBe("Failure")
  }).pipe(Effect.provide(databaseLayer), Effect.scoped),
)

it.effect("round-trips sliced Float32 arrays through the SQLite BLOB schema", () =>
  Effect.gen(function* () {
    const source = new Float32Array([99, 1.25, -2.5, 99]).subarray(1, 3)
    const encoded = yield* Schema.encodeEffect(Float32ArrayFromBlob)(source)
    const decoded = yield* Schema.decodeEffect(Float32ArrayFromBlob)(encoded)

    expect(encoded.byteLength).toBe(2 * Float32Array.BYTES_PER_ELEMENT)
    expect([...decoded]).toEqual([1.25, -2.5])
  }),
)

it.effect("rejects malformed Float32 BLOB byte lengths", () =>
  Effect.gen(function* () {
    const result = yield* Effect.result(
      Schema.decodeEffect(Float32ArrayFromBlob)(new Uint8Array(3)),
    )
    expect(result._tag).toBe("Failure")
  }),
)

it.effect("reopens a migrated file database with its committed data", () => {
  const path = join(tmpdir(), `pix-index-${randomUUID()}.db`)
  const layer = Layer.provideMerge(sqliteIndexDatabaseLayer(path), NodeServices.layer)
  const run = <A, E>(effect: Effect.Effect<A, E, SqlClient.SqlClient>) =>
    effect.pipe(Effect.provide(layer), Effect.scoped)

  return Effect.gen(function* () {
    const fs = yield* FileSystem
    yield* Effect.addFinalizer(() =>
      Effect.forEach(
        [path, `${path}-shm`, `${path}-wal`],
        (candidate) =>
          Effect.gen(function* () {
            if (yield* fs.exists(candidate)) yield* fs.remove(candidate)
          }),
        { discard: true },
      ).pipe(Effect.orDie),
    )

    const defaultedChunkTokens = yield* run(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        return yield* Effect.result(sql`
          INSERT INTO index_meta (id, model, dims, dtype, last_index)
          VALUES (1, 'missing-tokens', 384, 'fp32', 1)
        `)
      }),
    )
    expect(defaultedChunkTokens._tag).toBe("Success")

    yield* run(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* sql`
          UPDATE index_meta
          SET model = 'reopen-model', chunk_tokens = 512
          WHERE id = 1
        `
      }),
    )

    const rows = yield* run(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        return yield* sql<{
          readonly model: string
          readonly diagnostics: string
          readonly chunkTokens: number
        }>`SELECT model, diagnostics, chunk_tokens AS chunkTokens FROM index_meta WHERE id = 1`
      }),
    )
    expect(rows[0]?.model).toBe("reopen-model")
    expect(rows[0]?.diagnostics).toBe("[]")
    expect(rows[0]?.chunkTokens).toBe(512)
  }).pipe(Effect.provide(NodeServices.layer), Effect.scoped)
})
