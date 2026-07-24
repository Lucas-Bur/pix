import { Schema } from "effect"

import { ChunkValidationErrorSchema } from "./errors.js"

/** Defaults shared by every query transport. */
export const QUERY_DEFAULTS = {
  top: 5,
  contextLines: 0,
  ignorePath: [] as readonly string[],
  onlyPath: [] as readonly string[],
  noContent: false,
} as const

/** Transport-independent retrieval options. Runtime output controls are excluded. */
export const QueryOptionsSchema = Schema.Struct({
  top: Schema.optional(Schema.Number),
  contextLines: Schema.optional(Schema.Number),
  ignorePath: Schema.optional(Schema.Array(Schema.String)),
  onlyPath: Schema.optional(Schema.Array(Schema.String)),
  maxCharacters: Schema.optional(Schema.Number),
  noContent: Schema.optional(Schema.Boolean),
})

/** Query request accepted by application and protocol adapters. */
export const QueryRequestSchema = Schema.Struct({
  queryText: Schema.String,
  ...QueryOptionsSchema.fields,
})

/** Decoded transport-independent query request. */
export type QueryRequest = typeof QueryRequestSchema.Type

const QueryResultSchema = Schema.Struct({
  score: Schema.Number,
  rel: Schema.Number,
  file: Schema.String,
  startLine: Schema.Number,
  endLine: Schema.Number,
  text: Schema.Union([Schema.String, Schema.Null]),
  contextBefore: Schema.Union([Schema.String, Schema.Null]),
  contextAfter: Schema.Union([Schema.String, Schema.Null]),
})

const QueryIndexRefreshSchema = Schema.Struct({
  kind: Schema.Literals(["full", "incremental", "none"]),
  processedFiles: Schema.Number,
  reusedFiles: Schema.Number,
  cacheHits: Schema.Number,
  cacheMisses: Schema.Number,
})

const QueryWarningSchema = Schema.Struct({
  _tag: Schema.Literal("TopKClamped"),
  requested: Schema.Number,
  applied: Schema.Number,
})

/** Structured response shared by CLI and MCP query adapters. */
export const QueryResponseSchema = Schema.Struct({
  indexRefresh: QueryIndexRefreshSchema,
  results: Schema.Array(QueryResultSchema),
  validationErrors: Schema.Array(ChunkValidationErrorSchema),
  warnings: Schema.Array(QueryWarningSchema),
})

/** Structured response returned by the shared query application API. */
export type QueryResponse = typeof QueryResponseSchema.Type

/** Query request after shared defaults have been applied. */
export interface NormalizedQueryRequest {
  readonly queryText: string
  readonly top: number
  readonly contextLines: number
  readonly ignorePath: readonly string[]
  readonly onlyPath: readonly string[]
  readonly maxCharacters: number | undefined
  readonly noContent: boolean
}

/** Apply defaults shared by CLI, aliases, and MCP. */
export const normalizeQueryRequest = (request: QueryRequest): NormalizedQueryRequest => ({
  queryText: request.queryText,
  top: request.top ?? QUERY_DEFAULTS.top,
  contextLines: request.contextLines ?? QUERY_DEFAULTS.contextLines,
  ignorePath: request.ignorePath ?? QUERY_DEFAULTS.ignorePath,
  onlyPath: request.onlyPath ?? QUERY_DEFAULTS.onlyPath,
  maxCharacters: request.maxCharacters,
  noContent: request.noContent ?? QUERY_DEFAULTS.noContent,
})

/** Query options that may be saved in an alias. */
export const SavedQueryOptionsSchema = QueryOptionsSchema
