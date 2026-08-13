import { Schema } from "effect"

import type { EmbeddingDtype } from "./dtype.js"

/** Shared source-location fields for working and persisted chunks. */
export const ChunkLocationSchema = Schema.Struct({
  id: Schema.String,
  idx: Schema.Finite,
  file: Schema.String,
  startLine: Schema.Finite,
  endLine: Schema.Finite,
  startOffset: Schema.Finite,
  endOffset: Schema.Finite,
})

/** Runtime schema for a working chunk before source text is removed for persistence. */
const ChunkSchema = Schema.Struct({
  ...ChunkLocationSchema.fields,
  text: Schema.String,
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
