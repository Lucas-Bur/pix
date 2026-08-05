import { Effect } from "effect"
import { SqlClient } from "effect/unstable/sql"

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient

  yield* sql`ALTER TABLE index_meta
    ADD COLUMN diagnostics TEXT NOT NULL DEFAULT '[]'
    CHECK (json_valid(diagnostics))`
})
