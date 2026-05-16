import { Schema } from "effect"

/** Runtime schema for persisted/searchable chunk entries. */
export const ChunkSchema = Schema.Struct({
  id: Schema.String,
  idx: Schema.Number,
  file: Schema.String,
  startLine: Schema.Number,
  endLine: Schema.Number,
  text: Schema.String,
  contextBefore: Schema.Union(Schema.String, Schema.Null),
  contextAfter: Schema.Union(Schema.String, Schema.Null),
})

/** Domain chunk type inferred from ChunkSchema. */
export type Chunk = typeof ChunkSchema.Type
