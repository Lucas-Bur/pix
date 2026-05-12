import { Command, Options } from "@effect/cli"
import { Effect } from "effect"

import { InitProject } from "../application/init-project.js"
import { formatError } from "../lib/error-format.js"

/** CLI command: pix init [--json] */
export const initCommand = Command.make(
  "init",
  {
    json: Options.boolean("json").pipe(Options.withDefault(false)),
  },
  ({ json }) =>
    Effect.gen(function* () {
      const result = yield* InitProject.init()

      if (json) {
        return yield* Effect.sync(() => {
          console.log(JSON.stringify(result, null, 2))
        })
      }

      yield* Effect.logInfo("Created .pix/config.json with default settings.")
      yield* Effect.logInfo(
        "Reminder: Add `.pix` to your `.gitignore` file to avoid committing the index.",
      )
    }).pipe(
      Effect.catchAll((error) =>
        Effect.sync(() => {
          console.log(formatError(error))
        }),
      ),
    ),
)
