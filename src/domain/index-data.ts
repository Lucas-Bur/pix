import { Schema } from "effect"

import { ChunkLocationSchema } from "./chunk.js"
import { EmbeddingDtypeSchema } from "./dtype.js"

/** Runtime schema for chunk metadata persisted without source text. */
export const StoredChunkSchema = Schema.Struct({
  ...ChunkLocationSchema.fields,
  contentHash: Schema.String,
})

/** Persisted chunk metadata inferred from StoredChunkSchema. */
export type StoredChunk = typeof StoredChunkSchema.Type

/** Runtime schema for one observed source file in the index manifest. */
export const FileManifestEntrySchema = Schema.Struct({
  file: Schema.String,
  mtimeMs: Schema.Number,
  size: Schema.Number,
  contentHash: Schema.String,
})

/** Persisted source-file observation inferred from FileManifestEntrySchema. */
export type FileManifestEntry = typeof FileManifestEntrySchema.Type

/** Runtime schema for a content-addressed embedding cache record. */
export const EmbeddingCacheEntrySchema = Schema.Struct({
  contentHash: Schema.String,
  model: Schema.String,
  dims: Schema.Number,
  dtype: EmbeddingDtypeSchema,
  vector: Schema.String,
})
