import { Command, Options } from "@effect/cli"
import { Console, Effect } from "effect"

import { IndexProject } from "../application/index-project.js"
import { reportError } from "../lib/error-format.js"

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

      const result = yield* IndexProject.index()

      const duration = `${((Date.now() - startTime) / 1000).toFixed(1)}s`

      if (json) {
        return yield* Console.log(
          JSON.stringify({
            chunks: result.status.chunks,
            files: result.status.files,
            duration,
          }),
        )
      }

      yield* Effect.logInfo(
        `Indexed ${result.status.chunks} chunks from ${result.status.files} files in ${duration}.`,
      )
    }).pipe(
      Effect.catchTags({
        ConfigError: reportError,
        ConfigNotFoundError: reportError,
        ConfigMalformedError: reportError,
        ScanFailed: reportError,
        ChunkerError: reportError,
        ModelLoadError: reportError,
        InferenceError: reportError,
        DiskFullError: reportError,
        StoreError: reportError,
        NoIndexError: reportError,
      }),
    ),
)
