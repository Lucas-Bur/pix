import { Command, Options } from "@effect/cli"
import { Effect } from "effect"

import { IndexProject } from "../application/index-project.js"

/** CLI command: pix index [--force] [--verbose] [--json] */
export const indexCommand = Command.make(
  "index",
  {
    force: Options.boolean("force").pipe(Options.withDefault(false)),
    verbose: Options.boolean("verbose").pipe(Options.withDefault(false)),
    json: Options.boolean("json").pipe(Options.withDefault(false)),
  },
  ({ force: _force, verbose: _verbose, json }) =>
    Effect.gen(function* () {
      const startTime = Date.now()

      const result = yield* IndexProject.index().pipe(Effect.either)

      if (result._tag === "Left") {
        // Index failed — output JSON error if --json flag set
        const error = result.left
        const message = error.message ?? String(error)
        yield* Effect.sync(() => {
          console.log(JSON.stringify({ error: message }))
        })
        // Fail the effect so CLI exits with non-zero code
        return yield* Effect.fail(error)
      }

      const duration = `${((Date.now() - startTime) / 1000).toFixed(1)}s`

      if (json) {
        return yield* Effect.sync(() => {
          console.log(
            JSON.stringify({
              chunks: result.right.stats.chunks,
              files: result.right.stats.files,
              duration,
            }),
          )
        })
      }

      yield* Effect.logInfo(
        `Indexed ${result.right.stats.chunks} chunks from ${result.right.stats.files} files in ${duration}.`,
      )
    }),
)
