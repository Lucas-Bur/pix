import { Schema } from "effect"

import { EmbeddingDtypeSchema } from "./dtype.js"

const EmbedderConfigSchema = Schema.Struct({
  model: Schema.String,
  device: Schema.Literals(["auto", "cpu", "cuda", "dml", "coreml", "webgpu", "wasm"]),
  dtype: EmbeddingDtypeSchema,
  batchSize: Schema.Number,
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
}
