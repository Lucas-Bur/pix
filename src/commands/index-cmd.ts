import { Command, Options } from "@effect/cli"
import { Effect } from "effect"

import { IndexProject } from "../application/index-project.js"
import { formatError } from "../lib/error-format.js"

/** CLI command: pix index [--force] [--verbose] [--json] */
export const indexCommand = Command.make(
  "index",
  {
    force: Options.boolean("force").pipe(Options.withDefault(false)),
    verbose: Options.boolean("verbose").pipe(Options.withDefault(false)),
    json: Options.boolean("json").pipe(Options.withDefault(false)),
  },
  ({ force, verbose, json }) =>
    Effect.gen(function* () {
      if (force && !json) {
        yield* Effect.logInfo("--force is currently not implemented and only a placeholder.")
      }

      if (verbose && !json) {
        yield* Effect.logInfo("--verbose is currently not implemented and only a placeholder.")
      }

      const startTime = Date.now()

      const result = yield* IndexProject.index().pipe(Effect.either)

      if (result._tag === "Left") {
        return yield* Effect.fail(result.left)
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
    }).pipe(
      Effect.tapError((error) =>
        Effect.sync(() => {
          console.log(formatError(error))
        }),
      ),
    ),
)
