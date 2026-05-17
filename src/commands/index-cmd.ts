import { Command, Options } from "@effect/cli"
import { Effect, Option } from "effect"

import { IndexProject } from "../application/index-project.js"
import type { IndexOptions } from "../application/index-project.js"
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

const splitCsv = (values: ReadonlyArray<string>): string[] =>
  values.flatMap((v) =>
    v
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0),
  )

const buildIndexOptions = (args: {
  batchSize: Option.Option<number>
  chunkConcurrency: Option.Option<number>
  skipExtensions: ReadonlyArray<string>
  ignorePath: ReadonlyArray<string>
  ignorePaths: ReadonlyArray<string>
  ignoreGitignore: boolean
}): IndexOptions => {
  const cliSkipExtensions = splitCsv(args.skipExtensions)
  const cliIgnorePaths = [
    ...args.ignorePath.map((s) => s.trim()).filter((s) => s.length > 0),
    ...splitCsv(args.ignorePaths),
  ]

  return {
    batchSize: Option.isSome(args.batchSize) ? args.batchSize.value : undefined,
    chunkConcurrency: Option.isSome(args.chunkConcurrency)
      ? args.chunkConcurrency.value
      : undefined,
    skipExtensions: cliSkipExtensions.length > 0 ? cliSkipExtensions : undefined,
    ignorePaths: cliIgnorePaths.length > 0 ? cliIgnorePaths : undefined,
    ignoreGitignore: args.ignoreGitignore || undefined,
  }
}

const emitIndexResult = (
  d: typeof Display.Service,
  result: {
    status: { chunks: number; files: number; totalLines: number; byteSize: number }
    durationMs: number
    embedderFallback?: { originalDevice: string; reason: string }
  },
): Effect.Effect<void> =>
  Effect.gen(function* () {
    yield* d.json({
      chunks: result.status.chunks,
      files: result.status.files,
      totalLines: result.status.totalLines,
      byteSize: result.status.byteSize,
      durationMs: result.durationMs,
      ...(result.embedderFallback && { embedderFallback: result.embedderFallback }),
    })

    if (result.status.chunks === 0) {
      yield* d.log("No chunks to index.", "warn")
    }
  })

export const indexCommand = Command.make(
  "index",
  {
    json: Options.boolean("json").pipe(Options.withDefault(false)),
    batchSize: batchSizeOption,
    chunkConcurrency: chunkConcurrencyOption,
    skipExtensions: skipExtensionsOption,
    ignorePath: ignorePathOption,
    ignorePaths: ignorePathsOption,
    ignoreGitignore: ignoreGitignoreOption,
  },
  ({ batchSize, chunkConcurrency, skipExtensions, ignorePath, ignorePaths, ignoreGitignore }) =>
    Effect.gen(function* () {
      const d = yield* Display

      const options = buildIndexOptions({
        batchSize,
        chunkConcurrency,
        skipExtensions,
        ignorePath,
        ignorePaths,
        ignoreGitignore,
      })

      const result = yield* d.spinner("Indexing project...", IndexProject.index(options))

      yield* emitIndexResult(d, result)
    }).pipe(Effect.catchAll(reportError)),
)
