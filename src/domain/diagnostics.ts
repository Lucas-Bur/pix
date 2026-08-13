import { Schema } from "effect"

/** Runtime schema for one indexing diagnostic retained with the active snapshot. */
export const IndexDiagnosticSchema = Schema.Struct({
  kind: Schema.Literals(["skipped-file", "skipped-chunk", "parser-fallback"]),
  file: Schema.String,
  message: Schema.String,
  startLine: Schema.optional(Schema.Finite),
  endLine: Schema.optional(Schema.Finite),
  model: Schema.optional(Schema.String),
  actualTokens: Schema.optional(Schema.Finite),
  limit: Schema.optional(Schema.Finite),
})

/** Diagnostic emitted while indexing without aborting the complete refresh. */
export type IndexDiagnostic = typeof IndexDiagnosticSchema.Type
