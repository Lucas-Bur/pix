import { Command } from "@effect/cli"
import { Effect } from "effect"

import { writeConfig, configExists } from "../services/store.ts"
import { DEFAULT_CONFIG } from "../types.ts"

/**
 * Run the `pix init` command logic.
 *
 * Creates `.pix/config.json` with default settings: - schema: "1" (config schema version) - model:
 * "Xenova/all-MiniLM-L6-v2" (ONNX embedding model) - dims: 384 (embedding dimensions) - chunkLines:
 * 60 (lines per chunk) - overlapLines: 10 (overlapping lines between chunks) - files: {} (empty
 * mtime cache for MVP)
 *
 * Also outputs a reminder to add `.pix` to `.gitignore`.
 */
export const runInit = Effect.gen(function* () {
  const exists = yield* configExists()

  if (exists) {
    yield* Effect.logInfo("Config already exists, overwriting with defaults")
  }

  yield* writeConfig(DEFAULT_CONFIG)

  yield* Effect.logInfo("Created .pix/config.json with default settings.")
  yield* Effect.logInfo(
    "Reminder: Add `.pix` to your `.gitignore` file to avoid committing the index.",
  )
})

/**
 * The `pix init` CLI command.
 *
 * Creates a `.pix/` directory with `config.json` containing default settings for the pix indexer.
 * The config includes the embedding model, chunk size, and other indexing parameters.
 *
 * After running, add `.pix` to your `.gitignore` to avoid committing the index to version control.
 */
export const initCommand = Command.make("init", {}, () => runInit)
