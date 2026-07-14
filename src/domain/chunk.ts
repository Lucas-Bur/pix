import { Schema } from "effect"

import type { EmbeddingDtype } from "./dtype.js"

/** Runtime schema for persisted/searchable chunk entries. */
export const ChunkSchema = Schema.Struct({
  id: Schema.String,
  idx: Schema.Number,
  file: Schema.String,
  startLine: Schema.Number,
  endLine: Schema.Number,
  startOffset: Schema.Number,
  endOffset: Schema.Number,
  text: Schema.String,
  contextBefore: Schema.Union([Schema.String, Schema.Null]),
  contextAfter: Schema.Union([Schema.String, Schema.Null]),
})

/** Domain chunk type inferred from ChunkSchema. */
export type Chunk = typeof ChunkSchema.Type

/**
 * Numeric vector representation of a text chunk, produced by the Embedder and consumed by
 * IndexStore.
 */
export interface Embedding {
  /** Dense vector values — contiguous Float32Array for SIMD-eligible arithmetic (see ADR-0008). */
  readonly vector: Float32Array
  /**
   * Dimensionality of the vector (length of `vector`). Must match the index dims for cosine
   * scoring.
   */
  readonly dims: number
  /** Storage precision used for this embedding (e.g. "fp32"). */
  readonly dtype: EmbeddingDtype
}
