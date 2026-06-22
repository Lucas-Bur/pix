import { Command, Options } from "@effect/cli"
import { Effect } from "effect"

import { InitProject } from "../application/init-project.js"
import { Display } from "../domain/ports.js"
import { reportError } from "../lib/errors/error-format.js"
import { ModelRegistry } from "../services/models.js"

/** CLI command: pix init [--json] */
export const initCommand = Command.make(
  "init",
  {
    json: Options.boolean("json").pipe(Options.withDefault(false)),
  },
  () =>
    Effect.gen(function* () {
      const d = yield* Display
      const registry = yield* ModelRegistry
      const modelIds = yield* registry.list()

      const defaultModel = "Xenova/all-MiniLM-L6-v2"
      const selectedModel = yield* d.select(
        "Select embedding model:",
        modelIds.map((id) => ({ value: id, label: id })),
        defaultModel,
      )

      const result = yield* d.spinner("Initializing...", InitProject.init(selectedModel))

      yield* d.json(result)
      yield* d.log(`Created .pix/config.json with model "${selectedModel}".`, "success")
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
