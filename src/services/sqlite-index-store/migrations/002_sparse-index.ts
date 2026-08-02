import { Effect } from "effect"
import { SqlClient } from "effect/unstable/sql"

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient

  yield* sql`CREATE TABLE sparse_index_meta (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      model TEXT NOT NULL,
      model_revision TEXT NOT NULL,
      tokenizer TEXT NOT NULL,
      tokenizer_revision TEXT NOT NULL,
      idf_revision TEXT NOT NULL,
      idf_content_hash TEXT NOT NULL
    ) STRICT`

  yield* sql`CREATE TABLE sparse_terms (
      chunk_ordinal INTEGER NOT NULL REFERENCES chunks(ordinal) ON DELETE CASCADE,
      token_id INTEGER NOT NULL CHECK (token_id >= 0),
      weight REAL NOT NULL CHECK (weight > 0),
      PRIMARY KEY (chunk_ordinal, token_id)
    ) STRICT`

  yield* sql`CREATE TABLE sparse_idf (
      token_id INTEGER PRIMARY KEY CHECK (token_id >= 0),
      weight REAL NOT NULL CHECK (weight > 0)
    ) STRICT`

  yield* sql`CREATE INDEX sparse_terms_token_postings
    ON sparse_terms(token_id, chunk_ordinal, weight)`
})
