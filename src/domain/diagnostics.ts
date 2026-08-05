import { Schema } from "effect"

/** Runtime schema for one indexing diagnostic retained with the active snapshot. */
export const IndexDiagnosticSchema = Schema.Struct({
  kind: Schema.Literals(["skipped-file", "skipped-chunk", "parser-fallback"]),
  file: Schema.String,
  message: Schema.String,
  startLine: Schema.optional(Schema.Number),
  endLine: Schema.optional(Schema.Number),
  model: Schema.optional(Schema.String),
  actualTokens: Schema.optional(Schema.Number),
  limit: Schema.optional(Schema.Number),
})

/** Diagnostic emitted while indexing without aborting the complete refresh. */
export type IndexDiagnostic = typeof IndexDiagnosticSchema.Type
