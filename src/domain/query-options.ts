import { Schema } from "effect"

/** Query options that may be saved in an alias. Runtime output flags are excluded. */
export const SavedQueryOptionsSchema = Schema.Struct({
  top: Schema.optional(Schema.Number),
  contextLines: Schema.optional(Schema.Number),
  ignorePath: Schema.optional(Schema.Array(Schema.String)),
  onlyPath: Schema.optional(Schema.Array(Schema.String)),
  maxCharacters: Schema.optional(Schema.Number),
  noContent: Schema.optional(Schema.Boolean),
})
