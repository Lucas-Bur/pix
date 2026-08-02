import { Schema } from "effect"

import { EmbeddingDtypeSchema } from "./dtype.js"
import {
  SPARSE_DOCUMENT_MODEL,
  SPARSE_DOCUMENT_REVISION,
  SPARSE_IDF_CONTENT_HASH,
  SPARSE_QUERY_MODEL,
  SPARSE_QUERY_REVISION,
} from "./sparse.js"

const EmbedderConfigSchema = Schema.Struct({
  model: Schema.String,
  device: Schema.Literals(["auto", "cpu", "cuda", "dml", "coreml", "webgpu", "wasm"]),
  dtype: EmbeddingDtypeSchema,
  batchSize: Schema.Number,
})

const PositiveInt = Schema.Int.check(Schema.isGreaterThan(0))

const SparseEmbedderConfigSchema = Schema.Struct({
  model: Schema.String,
  modelRevision: Schema.String,
  queryModel: Schema.String,
  queryRevision: Schema.String,
  idfContentHash: Schema.String,
  device: Schema.Literals(["auto", "cpu", "cuda", "dml", "coreml", "webgpu", "wasm"]),
  batchSize: PositiveInt,
})

/** Available SQLite vector scan strategies. */
const VectorSearchModeSchema = Schema.Literals(["exact", "auto", "turboquant"])

const VectorSearchConfigSchema = Schema.Struct({
  mode: VectorSearchModeSchema,
  turboQuantThreshold: Schema.Number,
})

/**
 * Runtime schema for persisted project configuration. Defines the structure and validation rules
 * for `.pix/config.json`.
 */
export const ConfigSchema = Schema.Struct({
  chunkLines: Schema.Number,
  overlapLines: Schema.Number,
  chunkConcurrency: Schema.Number,
  minChunkChars: Schema.Number,
  skipExtensions: Schema.Array(Schema.String),
  ignoredPaths: Schema.Array(Schema.String),
  ignoreGitignore: Schema.Boolean,
  embedder: EmbedderConfigSchema,
  sparseEmbedder: SparseEmbedderConfigSchema,
  vectorSearch: VectorSearchConfigSchema,
})

/** Domain config type inferred from ConfigSchema. */
export type Config = typeof ConfigSchema.Type

export const DEFAULT_CONFIG: Config = {
  chunkLines: 60,
  overlapLines: 10,
  chunkConcurrency: 8,
  minChunkChars: 20,
  skipExtensions: [],
  ignoredPaths: [
    ".pix",
    "node_modules",
    ".git",
    "dist",
    "build",
    ".next",
    ".vscode",
    "coverage",
    "*-lock.yaml",
    "*-lock.json",
    "*.lock",
    ".vite-hooks",
    ".fallow",
  ],
  ignoreGitignore: false,
  embedder: {
    model: "Xenova/all-MiniLM-L6-v2",
    device: "auto",
    dtype: "fp32",
    batchSize: 16,
  },
  sparseEmbedder: {
    model: SPARSE_DOCUMENT_MODEL,
    modelRevision: SPARSE_DOCUMENT_REVISION,
    queryModel: SPARSE_QUERY_MODEL,
    queryRevision: SPARSE_QUERY_REVISION,
    idfContentHash: SPARSE_IDF_CONTENT_HASH,
    device: "auto",
    batchSize: 2,
  },
  vectorSearch: {
    mode: "exact",
    turboQuantThreshold: 50_000,
  },
}
