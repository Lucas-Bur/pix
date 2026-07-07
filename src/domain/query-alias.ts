import { Schema } from "effect"

import { SavedQueryOptionsSchema } from "./query-options.js"

/** Options persisted with a saved query alias. */
export type QueryAliasOptions = typeof SavedQueryOptionsSchema.Type

/** Persisted alias entry keyed by alias name in `.pix/aliases.json`. */
const QueryAliasEntrySchema = Schema.Struct({
  queryText: Schema.String,
  options: SavedQueryOptionsSchema,
})

/** A saved query-only preset. */
export type QueryAlias = typeof QueryAliasEntrySchema.Type & { readonly name: string }

/** On-disk query alias registry stored as `.pix/aliases.json`. */
export const QueryAliasRegistrySchema = Schema.Record(Schema.String, QueryAliasEntrySchema)

/** On-disk query alias registry stored as `.pix/aliases.json`. */
export type QueryAliasRegistry = typeof QueryAliasRegistrySchema.Type

/** Empty alias registry for projects with no saved aliases yet. */
export const EMPTY_QUERY_ALIAS_REGISTRY: QueryAliasRegistry = {}
