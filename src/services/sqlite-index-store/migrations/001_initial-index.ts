import { Effect } from "effect"
import { SqlClient } from "effect/unstable/sql"

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient

  yield* sql`CREATE TABLE index_meta (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      model TEXT NOT NULL,
      dims INTEGER NOT NULL CHECK (dims > 0),
      dtype TEXT NOT NULL,
      last_index REAL NOT NULL
    ) STRICT`

  yield* sql`CREATE TABLE chunks (
      ordinal INTEGER PRIMARY KEY,
      id TEXT NOT NULL,
      idx INTEGER NOT NULL,
      file TEXT NOT NULL,
      start_line INTEGER NOT NULL,
      end_line INTEGER NOT NULL,
      start_offset INTEGER NOT NULL,
      end_offset INTEGER NOT NULL,
      content_hash TEXT NOT NULL,
      embedding BLOB NOT NULL,
      UNIQUE (id)
    ) STRICT`

  yield* sql`CREATE INDEX chunks_file_idx ON chunks(file)`

  yield* sql`CREATE TABLE files (
      file TEXT PRIMARY KEY,
      mtime_ms INTEGER NOT NULL,
      size INTEGER NOT NULL,
      content_hash TEXT NOT NULL
    ) STRICT`

  yield* sql`CREATE TABLE retrieval_indexes (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      bm25_json TEXT NOT NULL CHECK (json_valid(bm25_json)),
      identifier_json TEXT NOT NULL CHECK (json_valid(identifier_json))
    ) STRICT`

  yield* sql`CREATE TABLE embedding_cache (
      content_hash TEXT NOT NULL,
      model TEXT NOT NULL,
      dims INTEGER NOT NULL CHECK (dims > 0),
      dtype TEXT NOT NULL,
      embedding BLOB NOT NULL,
      PRIMARY KEY (content_hash, model, dims, dtype)
    ) STRICT`
})
