import { Schema } from "effect"

import { ChunkValidationErrorSchema } from "./errors.js"

/** Transport-independent options for refreshing a pix index. */
export const IndexRequestSchema = Schema.Struct({
  batchSize: Schema.optional(Schema.Number),
  chunkConcurrency: Schema.optional(Schema.Number),
  skipExtensions: Schema.optional(Schema.Array(Schema.String)),
  ignorePaths: Schema.optional(Schema.Array(Schema.String)),
  ignoreGitignore: Schema.optional(Schema.Boolean),
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
