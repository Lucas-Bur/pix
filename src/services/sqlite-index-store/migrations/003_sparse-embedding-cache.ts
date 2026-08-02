import { Effect } from "effect"
import { SqlClient } from "effect/unstable/sql"

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient

  yield* sql`CREATE TABLE sparse_embedding_cache (
      content_hash TEXT NOT NULL,
      model TEXT NOT NULL,
      model_revision TEXT NOT NULL,
      tokenizer TEXT NOT NULL,
      tokenizer_revision TEXT NOT NULL,
      idf_revision TEXT NOT NULL,
      idf_content_hash TEXT NOT NULL,
      vector_json TEXT NOT NULL CHECK (json_valid(vector_json)),
      PRIMARY KEY (
        content_hash,
        model,
        model_revision,
        tokenizer,
        tokenizer_revision,
        idf_revision,
        idf_content_hash
      )
    ) STRICT`
})
