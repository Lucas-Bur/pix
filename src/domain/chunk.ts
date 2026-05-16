import { Schema } from "effect"

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

export type Chunk = typeof ChunkSchema.Type
