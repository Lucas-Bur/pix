import { Command } from "@effect/cli"
import { Effect } from "effect"

import { DEFAULT_CONFIG } from "../domain/config.js"
import { ConfigStore } from "../domain/ports.js"

export const runInit = Effect.gen(function* () {
  const store = yield* ConfigStore
  const exists = yield* store.configExists()

  if (exists) {
    yield* Effect.logInfo("Config already exists, overwriting with defaults")
  }

  yield* store.writeConfig(DEFAULT_CONFIG)

  yield* Effect.logInfo("Created .pix/config.json with default settings.")
  yield* Effect.logInfo(
    "Reminder: Add `.pix` to your `.gitignore` file to avoid committing the index.",
  )
})

export const initCommand = Command.make("init", {}, () => runInit)
