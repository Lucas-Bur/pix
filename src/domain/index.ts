import { Schema } from "effect"

import { ChunkValidationErrorSchema } from "./errors.js"

const PositiveInt = Schema.Number.check(Schema.isInt(), Schema.isGreaterThan(0))

/** Transport-independent options for refreshing a pix index. */
export const IndexRequestSchema = Schema.Struct({
  batchSize: Schema.optional(
    PositiveInt.pipe(Schema.annotate({ description: "Number of chunks embedded in one batch." })),
  ),
  chunkConcurrency: Schema.optional(
    PositiveInt.pipe(
      Schema.annotate({ description: "Maximum number of chunks processed concurrently." }),
    ),
  ),
  skipExtensions: Schema.optional(
    Schema.Array(Schema.String).pipe(
      Schema.annotate({
        description: "File extensions to skip while indexing, including the leading dot.",
      }),
    ),
  ),
  ignorePaths: Schema.optional(
    Schema.Array(Schema.String).pipe(
      Schema.annotate({ description: "Gitignore-style paths to exclude from indexing." }),
    ),
  ),
  ignoreGitignore: Schema.optional(
    Schema.Boolean.pipe(
      Schema.annotate({
        description: "Ignore .gitignore and .git/info/exclude rules during indexing.",
      }),
    ),
  ),
})

/** Decoded index refresh request. */
export type IndexRequest = typeof IndexRequestSchema.Type

/** Structured index result shared by CLI and MCP. */
export const IndexResponseSchema = Schema.Struct({
  success: Schema.Literal(true),
  refresh: Schema.Literals(["full", "incremental", "none"]),
  status: Schema.Struct({
    chunks: Schema.Number,
    files: Schema.Number,
    totalLines: Schema.Number,
    byteSize: Schema.Number,
    validationErrors: Schema.Array(ChunkValidationErrorSchema),
  }),
  durationMs: Schema.Number,
  cacheHits: Schema.Number,
  cacheMisses: Schema.Number,
  reusedFiles: Schema.Number,
  processedFiles: Schema.Number,
  embedderFallback: Schema.optional(
    Schema.Struct({ originalDevice: Schema.String, reason: Schema.String }),
  ),
})

/** Structured result returned by the shared index application API. */
export type IndexResponse = typeof IndexResponseSchema.Type

/** Normalize transport input to the options accepted by `IndexProject`. */
export const normalizeIndexRequest = (request: IndexRequest) => ({
  batchSize:
    request.batchSize !== undefined && request.batchSize > 0 ? request.batchSize : undefined,
  chunkConcurrency:
    request.chunkConcurrency !== undefined && request.chunkConcurrency > 0
      ? request.chunkConcurrency
      : undefined,
  skipExtensions:
    request.skipExtensions !== undefined && request.skipExtensions.length > 0
      ? request.skipExtensions
      : undefined,
  ignorePaths:
    request.ignorePaths !== undefined && request.ignorePaths.length > 0
      ? request.ignorePaths
      : undefined,
  ignoreGitignore: request.ignoreGitignore === true ? true : undefined,
})
