import { Command, Options } from "@effect/cli"
import { Effect } from "effect"

import { InitProject } from "../application/init-project.js"
import { Display } from "../display/Display.js"
import { reportError } from "../lib/error-format.js"

/** CLI command: pix init [--json] */
export const initCommand = Command.make(
  "init",
  {
    json: Options.boolean("json").pipe(Options.withDefault(false)),
  },
  () =>
    Effect.gen(function* () {
      const d = yield* Display
      const result = yield* d.spinner("Initializing...", InitProject.init())

      yield* d.json(result)
      yield* d.log("Created .pix/config.json with default settings.", "success")
      yield* d.note(
        "Add `.pix` to your `.gitignore` file to avoid committing the index.",
        "Reminder",
      )
    }).pipe(
      Effect.catchTags({
        ConfigError: reportError,
        DiskFullError: reportError,
      }),
    ),
)
