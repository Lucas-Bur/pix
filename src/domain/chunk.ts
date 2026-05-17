import { Schema } from "effect"

import type { EmbeddingDtype } from "./dtype.js"

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

export interface Embedding {
  readonly vector: Float32Array
  readonly dims: number
  readonly dtype: EmbeddingDtype
}
