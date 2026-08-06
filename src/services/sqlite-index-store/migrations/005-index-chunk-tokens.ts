import { Effect } from "effect"
import { SqlClient } from "effect/unstable/sql"

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient

  // Legacy indexes used the 512-token Dense/Sparse model limit before this column existed.
  yield* sql`ALTER TABLE index_meta
    ADD COLUMN chunk_tokens INTEGER NOT NULL DEFAULT 512`
})
