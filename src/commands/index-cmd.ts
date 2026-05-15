import { Command, Options } from "@effect/cli"
import { Effect } from "effect"

import { IndexProject } from "../application/index-project.js"
import { Display } from "../display/Display.js"
import { reportError } from "../lib/error-format.js"

/** CLI command: pix index [--force] [--verbose] [--json] */
export const indexCommand = Command.make(
  "index",
  {
    force: Options.boolean("force").pipe(Options.withDefault(false)),
    verbose: Options.boolean("verbose").pipe(Options.withDefault(false)),
    json: Options.boolean("json").pipe(Options.withDefault(false)),
  },
  ({ force, verbose }) =>
    Effect.gen(function* () {
      const d = yield* Display

      if (force)
        yield* d.status("--force is currently not implemented and only a placeholder.", "warn")
      if (verbose)
        yield* d.status("--verbose is currently not implemented and only a placeholder.", "warn")

      const result = yield* d.spinner("Indexing project...", IndexProject.index())

      yield* d.json({ chunks: result.status.chunks, files: result.status.files })

      if (result.status.chunks === 0) {
        yield* d.status("No chunks to index.", "warn")
      } else {
        yield* d.status(
          `Indexed ${result.status.chunks} chunks from ${result.status.files} files.`,
          "success",
        )
      }
    }).pipe(Effect.catchAll(reportError)),
)
