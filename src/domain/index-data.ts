import { Schema } from "effect"

import { ChunkLocationSchema } from "./chunk.js"

/** Runtime schema for chunk metadata persisted without source text. */
const StoredChunkSchema = Schema.Struct({
  ...ChunkLocationSchema.fields,
  contentHash: Schema.String,
})

/** Persisted chunk metadata inferred from StoredChunkSchema. */
export type StoredChunk = typeof StoredChunkSchema.Type

/** Runtime schema for one observed source file in the index manifest. */
const FileManifestEntrySchema = Schema.Struct({
  file: Schema.String,
  mtimeMs: Schema.Number,
  size: Schema.Number,
  contentHash: Schema.String,
})

/** Persisted source-file observation inferred from FileManifestEntrySchema. */
export type FileManifestEntry = typeof FileManifestEntrySchema.Type
