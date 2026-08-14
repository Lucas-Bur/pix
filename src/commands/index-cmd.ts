import { Effect, Option } from "effect"
import { Command, Flag } from "effect/unstable/cli"

import { runIndex } from "../application/run-index.js"
import type { IndexRequest, IndexResponse } from "../domain/index.js"
import { Display } from "../domain/ports.js"
import { reportError } from "../lib/errors/error-format.js"

const splitCsv = (value: string): string[] =>
  value
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)

const buildIndexOptions = (args: {
  batchSize: Option.Option<number>
  chunkTokens: Option.Option<number>
  chunkConcurrency: Option.Option<number>
  skipExtensions: Option.Option<string>
  ignorePath: Option.Option<string>
  ignorePaths: Option.Option<string>
  ignoreGitignore: boolean
}): IndexRequest => {
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

  return {
    batchSize: Option.getOrUndefined(args.batchSize),
    chunkTokens: Option.getOrUndefined(args.chunkTokens),
    chunkConcurrency: Option.getOrUndefined(args.chunkConcurrency),
    skipExtensions: cliSkipExtensions,
    ignorePaths: cliIgnorePaths,
    ignoreGitignore: args.ignoreGitignore,
  }
}

const emitIndexResult = (d: typeof Display.Service, result: IndexResponse): Effect.Effect<void> =>
  Effect.gen(function* () {
    yield* d.json({
      chunks: result.status.chunks,
      files: result.status.files,
      totalLines: result.status.totalLines,
      byteSize: result.status.byteSize,
      durationMs: result.durationMs,
      refresh: result.refresh,
      cacheHits: result.cacheHits,
      cacheMisses: result.cacheMisses,
      reusedFiles: result.reusedFiles,
      processedFiles: result.processedFiles,
      diagnostics: result.diagnostics,
      ...(result.embedderFallback && { embedderFallback: result.embedderFallback }),
    })

    if (result.status.chunks === 0) {
      yield* d.log("No chunks to index.", "warn")
    }
  })

export const indexCommand = Command.make(
  "index",
  {
    batchSize: Flag.integer("batch-size").pipe(Flag.withAlias("b"), Flag.optional),
    chunkTokens: Flag.integer("chunk-tokens").pipe(Flag.withAlias("t"), Flag.optional),
    chunkConcurrency: Flag.integer("chunk-concurrency").pipe(Flag.withAlias("c"), Flag.optional),
    skipExtensions: Flag.string("skip-extensions").pipe(Flag.withAlias("s"), Flag.optional),
    ignorePath: Flag.string("ignore-path").pipe(Flag.optional),
    ignorePaths: Flag.string("ignore-paths").pipe(Flag.optional),
    ignoreGitignore: Flag.boolean("ignore-gitignore"),
  },
  ({
    batchSize,
    chunkTokens,
    chunkConcurrency,
    skipExtensions,
    ignorePath,
    ignorePaths,
    ignoreGitignore,
  }) =>
    Effect.gen(function* () {
      const d = yield* Display

      const opts = buildIndexOptions({
        batchSize,
        chunkTokens,
        chunkConcurrency,
        skipExtensions,
        ignorePath,
        ignorePaths,
        ignoreGitignore,
      })

      const result = yield* d.spinner("Indexing project...", runIndex(opts))

      yield* emitIndexResult(d, result)
    }).pipe(Effect.catch(reportError)),
)
