import { Command, Options } from "@effect/cli"
import { Effect, Option } from "effect"

import { IndexProject } from "../application/index-project.js"
import { Display } from "../display/Display.js"
import { reportError } from "../lib/error-format.js"

const batchSizeOption = Options.integer("batch-size").pipe(Options.withAlias("b"), Options.optional)

const chunkConcurrencyOption = Options.integer("chunk-concurrency").pipe(
  Options.withAlias("c"),
  Options.optional,
)

const skipExtensionsOption = Options.text("skip-extensions").pipe(
  Options.withAlias("s"),
  Options.repeated,
)

const ignorePathOption = Options.text("ignore-path").pipe(Options.repeated)

const ignorePathsOption = Options.text("ignore-paths").pipe(Options.repeated)

const ignoreGitignoreOption = Options.boolean("ignore-gitignore").pipe(Options.withDefault(false))

export const indexCommand = Command.make(
  "index",
  {
    force: Options.boolean("force").pipe(Options.withDefault(false)),
    verbose: Options.boolean("verbose").pipe(Options.withDefault(false)),
    json: Options.boolean("json").pipe(Options.withDefault(false)),
    batchSize: batchSizeOption,
    chunkConcurrency: chunkConcurrencyOption,
    skipExtensions: skipExtensionsOption,
    ignorePath: ignorePathOption,
    ignorePaths: ignorePathsOption,
    ignoreGitignore: ignoreGitignoreOption,
  },
  ({
    force,
    verbose,
    batchSize,
    chunkConcurrency,
    skipExtensions,
    ignorePath,
    ignorePaths,
    ignoreGitignore,
  }) =>
    Effect.gen(function* () {
      const d = yield* Display

      if (force)
        yield* d.log("--force is currently not implemented and only a placeholder.", "warn")
      if (verbose)
        yield* d.log("--verbose is currently not implemented and only a placeholder.", "warn")

      const cliSkipExtensions = skipExtensions.flatMap((v) => v.split(",").map((s) => s.trim()))

      const cliIgnorePaths = [
        ...ignorePath,
        ...ignorePaths.flatMap((v) => v.split(",").map((s) => s.trim())),
      ]

      const result = yield* d.spinner(
        "Indexing project...",
        IndexProject.index({
          batchSize: Option.getOrUndefined(batchSize),
          chunkConcurrency: Option.getOrUndefined(chunkConcurrency),
          skipExtensions: cliSkipExtensions.length > 0 ? cliSkipExtensions : undefined,
          ignorePaths: cliIgnorePaths.length > 0 ? cliIgnorePaths : undefined,
          ignoreGitignore: ignoreGitignore || undefined,
        }),
      )

      yield* d.json({ chunks: result.status.chunks, files: result.status.files })

      if (result.status.chunks === 0) {
        yield* d.log("No chunks to index.", "warn")
      }
    }).pipe(Effect.catchAll(reportError)),
)
