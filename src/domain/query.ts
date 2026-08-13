import { Schema } from "effect"

import { ChunkValidationErrorSchema } from "./errors.js"
import { ProductionProfileNameSchema, type ProductionProfileName } from "./retrieval.js"

const Int = Schema.Int
const PositiveInt = Schema.Int.check(Schema.isGreaterThan(0))
const NonNegativeInt = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))

/** Defaults shared by every query transport. */
export const QUERY_DEFAULTS = {
  top: 5,
  contextLines: 0,
  ignorePath: [] as readonly string[],
  onlyPath: [] as readonly string[],
  noContent: false,
  profile: "compatibility" as const,
} as const

/** Transport-independent retrieval options. Runtime output controls are excluded. */
export const QueryOptionsSchema = Schema.Struct({
  top: Schema.optional(
    Int.pipe(
      Schema.annotate({ description: "Maximum number of matching source chunks to return." }),
    ),
  ),
  contextLines: Schema.optional(
    NonNegativeInt.pipe(
      Schema.annotate({
        description: "Number of source lines to include before and after each result.",
      }),
    ),
  ),
  ignorePath: Schema.optional(
    Schema.Array(Schema.String).pipe(
      Schema.annotate({ description: "Gitignore-style paths to exclude from the search." }),
    ),
  ),
  onlyPath: Schema.optional(
    Schema.Array(Schema.String).pipe(
      Schema.annotate({
        description: "Gitignore-style paths to include exclusively in the search.",
      }),
    ),
  ),
  maxCharacters: Schema.optional(
    PositiveInt.pipe(
      Schema.annotate({ description: "Maximum number of characters in the complete response." }),
    ),
  ),
  noContent: Schema.optional(
    Schema.Boolean.pipe(
      Schema.annotate({
        description: "Return file and line metadata without loading source text.",
      }),
    ),
  ),
  profile: Schema.optional(
    ProductionProfileNameSchema.pipe(
      Schema.annotate({
        description: "Explicit production retrieval profile; defaults to compatibility.",
      }),
    ),
  ),
})

/** Query request accepted by application and protocol adapters. */
export const QueryRequestSchema = Schema.Struct({
  queryText: Schema.String.pipe(
    Schema.annotate({
      description:
        "Natural-language description of the code or documentation to locate. Use concepts when the exact file or symbol is unknown.",
    }),
  ),
  ...QueryOptionsSchema.fields,
})

/** Decoded transport-independent query request. */
export type QueryRequest = typeof QueryRequestSchema.Type

const QueryResultSchema = Schema.Struct({
  score: Schema.Finite,
  rel: Schema.Finite,
  file: Schema.String,
  startLine: Schema.Finite,
  endLine: Schema.Finite,
  text: Schema.Union([Schema.String, Schema.Null]),
  contextBefore: Schema.Union([Schema.String, Schema.Null]),
  contextAfter: Schema.Union([Schema.String, Schema.Null]),
})

const QueryIndexRefreshSchema = Schema.Struct({
  kind: Schema.Literals(["full", "incremental", "none"]),
  processedFiles: Schema.Finite,
  reusedFiles: Schema.Finite,
  cacheHits: Schema.Finite,
  cacheMisses: Schema.Finite,
})

const QueryWarningSchema = Schema.Struct({
  _tag: Schema.Literal("TopKClamped"),
  requested: Schema.Finite,
  applied: Schema.Finite,
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
  readonly profile: ProductionProfileName
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
  profile: request.profile ?? QUERY_DEFAULTS.profile,
})

/** Query options that may be saved in an alias. */
export const SavedQueryOptionsSchema = QueryOptionsSchema
