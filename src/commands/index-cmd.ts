import { Effect, Option } from "effect"
import { Command, Flag } from "effect/unstable/cli"

import { runIndex } from "../application/run-index.js"
import type { IndexRequest, IndexResponse } from "../domain/index.js"
import { PositiveIntSchema } from "../domain/numeric.js"
import { Display } from "../domain/ports.js"
import { reportError } from "../lib/errors/error-format.js"

type IndexCommandInput = Command.Command.Config.Infer<typeof indexCommandConfig>

const buildIndexOptions = (args: IndexCommandInput): IndexRequest => {
  const cliSkipExtensions = args.skipExtension
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
  const cliIgnorePaths = args.ignorePath
    .map((value) => value.trim())
    .filter((value) => value.length > 0)

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

const indexCommandConfig = {
  batchSize: Flag.integer("batch-size").pipe(
    Flag.withSchema(PositiveIntSchema),
    Flag.withAlias("b"),
    Flag.withMetavar("COUNT"),
    Flag.withDescription("Number of chunks embedded in one batch"),
    Flag.optional,
  ),
  chunkTokens: Flag.integer("chunk-tokens").pipe(
    Flag.withSchema(PositiveIntSchema),
    Flag.withAlias("t"),
    Flag.withMetavar("TOKENS"),
    Flag.withDescription("Maximum composite tokens in one source chunk"),
    Flag.optional,
  ),
  chunkConcurrency: Flag.integer("chunk-concurrency").pipe(
    Flag.withSchema(PositiveIntSchema),
    Flag.withAlias("c"),
    Flag.withMetavar("COUNT"),
    Flag.withDescription("Maximum chunks processed concurrently"),
    Flag.optional,
  ),
  skipExtension: Flag.string("skip-extension").pipe(
    Flag.withAlias("s"),
    Flag.withMetavar("EXTENSION"),
    Flag.withDescription("File extension to skip, including its leading dot; may be repeated"),
    Flag.atLeast(0),
  ),
  ignorePath: Flag.string("ignore-path").pipe(
    Flag.withMetavar("PATTERN"),
    Flag.withDescription("Exclude a gitignore-style path pattern; may be repeated"),
    Flag.atLeast(0),
  ),
  ignoreGitignore: Flag.boolean("ignore-gitignore").pipe(
    Flag.withDescription("Index files even when excluded by .gitignore or .git/info/exclude"),
  ),
}

export const indexCommand = Command.make(
  "index",
  indexCommandConfig,
  ({ batchSize, chunkTokens, chunkConcurrency, skipExtension, ignorePath, ignoreGitignore }) =>
    Effect.gen(function* () {
      const d = yield* Display

      const opts = buildIndexOptions({
        batchSize,
        chunkTokens,
        chunkConcurrency,
        skipExtension,
        ignorePath,
        ignoreGitignore,
      })

      const result = yield* d.spinner("Indexing project...", runIndex(opts))

      yield* emitIndexResult(d, result)
    }).pipe(Effect.catch(reportError)),
).pipe(
  Command.withDescription(
    "Scan project files, update changed chunks, and persist Dense and Sparse retrieval data",
  ),
  Command.withShortDescription("Refresh the local semantic index"),
  Command.withExamples([
    {
      command: 'pix index --ignore-path "dist/**"',
      description: "Refresh while excluding an additional path pattern",
    },
  ]),
)
