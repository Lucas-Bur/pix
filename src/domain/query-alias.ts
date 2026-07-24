import { Schema } from "effect"

import { QueryOptionsSchema, SavedQueryOptionsSchema } from "./query.js"

/** Options persisted with a saved query alias. */
export type QueryAliasOptions = typeof SavedQueryOptionsSchema.Type

/** Persisted alias entry keyed by alias name in `.pix/aliases.json`. */
const QueryAliasEntrySchema = Schema.Struct({
  queryText: Schema.String,
  options: SavedQueryOptionsSchema,
})

/** Structured saved alias shared by CLI and MCP. */
export const QueryAliasSchema = Schema.Struct({
  name: Schema.String,
  ...QueryAliasEntrySchema.fields,
})

/** Request for creating or replacing a saved query alias. */
export const AliasAddRequestSchema = Schema.Struct({
  name: Schema.String.pipe(
    Schema.annotate({ description: "Alias name used to address this saved query later." }),
  ),
  queryText: Schema.String.pipe(
    Schema.annotate({ description: "Natural-language query to run when this alias is executed." }),
  ),
  ...QueryOptionsSchema.fields,
})

/** Decoded alias add request. */
export type AliasAddRequest = typeof AliasAddRequestSchema.Type

/** Request identifying one saved alias. */
export const AliasNameRequestSchema = Schema.Struct({
  name: Schema.String.pipe(Schema.annotate({ description: "Name of the saved alias." })),
})

/** Result returned after removing a saved alias. */
export const AliasRemoveResponseSchema = Schema.Struct({ removed: Schema.String })

/** Request for running a saved alias with optional query overrides. */
export const AliasRunRequestSchema = Schema.Struct({
  aliasName: Schema.String.pipe(
    Schema.annotate({ description: "Name of the saved alias to execute." }),
  ),
  ...QueryOptionsSchema.fields,
})

/** Decoded alias run request. */
export type AliasRunRequest = typeof AliasRunRequestSchema.Type

/** A saved query-only preset. */
export type QueryAlias = typeof QueryAliasSchema.Type

/** On-disk query alias registry stored as `.pix/aliases.json`. */
export const QueryAliasRegistrySchema = Schema.Record(Schema.String, QueryAliasEntrySchema)

/** On-disk query alias registry stored as `.pix/aliases.json`. */
export type QueryAliasRegistry = typeof QueryAliasRegistrySchema.Type

/** Empty alias registry for projects with no saved aliases yet. */
export const EMPTY_QUERY_ALIAS_REGISTRY: QueryAliasRegistry = {}
