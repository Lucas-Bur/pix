import { Effect, Option } from "effect"
import { Command, Flag } from "effect/unstable/cli"

import { IndexProject } from "../application/index-project.js"
import type { IndexResult } from "../application/index-project.js"
import { Display } from "../domain/ports.js"
import type { IndexOptions } from "../domain/ports.js"
import { reportError } from "../lib/errors/error-format.js"

const splitCsv = (value: string): string[] =>
  value
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)

const buildIndexOptions = (args: {
  batchSize: Option.Option<number>
  chunkConcurrency: Option.Option<number>
  skipExtensions: Option.Option<string>
  ignorePath: Option.Option<string>
  ignorePaths: Option.Option<string>
  ignoreGitignore: boolean
}): IndexOptions => {
  const cliSkipExtensions = Option.match(args.skipExtensions, {
    onNone: (): string[] => [],
    onSome: splitCsv,
  })
  const cliIgnorePaths = [
    ...Option.match(args.ignorePath, {
      onNone: (): string[] => [],
      onSome: (v) => [v.trim()].filter((s) => s.length > 0),
    }),
    ...Option.match(args.ignorePaths, {
      onNone: (): string[] => [],
      onSome: splitCsv,
    }),
  ]

  const batchSize =
    Option.isSome(args.batchSize) && args.batchSize.value > 0 ? args.batchSize.value : undefined
  const chunkConcurrency =
    Option.isSome(args.chunkConcurrency) && args.chunkConcurrency.value > 0
      ? args.chunkConcurrency.value
      : undefined

  return {
    batchSize,
    chunkConcurrency,
    skipExtensions: cliSkipExtensions.length > 0 ? cliSkipExtensions : undefined,
    ignorePaths: cliIgnorePaths.length > 0 ? cliIgnorePaths : undefined,
    ignoreGitignore: args.ignoreGitignore || undefined,
  }
}

const emitIndexResult = (d: typeof Display.Service, result: IndexResult): Effect.Effect<void> =>
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
    json: Flag.boolean("json").pipe(Flag.withDefault(false)),
    batchSize: Flag.integer("batch-size").pipe(Flag.withAlias("b"), Flag.optional),
    chunkConcurrency: Flag.integer("chunk-concurrency").pipe(Flag.withAlias("c"), Flag.optional),
    skipExtensions: Flag.string("skip-extensions").pipe(Flag.withAlias("s"), Flag.optional),
    ignorePath: Flag.string("ignore-path").pipe(Flag.optional),
    ignorePaths: Flag.string("ignore-paths").pipe(Flag.optional),
    ignoreGitignore: Flag.boolean("ignore-gitignore").pipe(Flag.withDefault(false)),
  },
  ({ batchSize, chunkConcurrency, skipExtensions, ignorePath, ignorePaths, ignoreGitignore }) =>
    Effect.gen(function* () {
      const d = yield* Display

      const opts = buildIndexOptions({
        batchSize,
        chunkConcurrency,
        skipExtensions,
        ignorePath,
        ignorePaths,
        ignoreGitignore,
      })

      const indexService = yield* IndexProject
      const result = yield* d.spinner("Indexing project...", indexService.index(opts))

      yield* emitIndexResult(d, result)
    }).pipe(Effect.catch(reportError)),
)
