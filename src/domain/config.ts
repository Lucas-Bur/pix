import { Schema } from "effect"

const EmbedderConfigSchema = Schema.Struct({
  model: Schema.String,
  device: Schema.Literal("auto", "cpu", "cuda", "dml", "coreml"),
  dtype: Schema.Literal("fp32", "fp16", "q8"),
  batchSize: Schema.Number,
})

/**
 * Runtime schema for persisted project configuration. Defines the structure and validation rules
 * for `.pix/config.json`.
 */
export const ConfigSchema = Schema.Struct({
  schema: Schema.Literal("1"),
  chunkLines: Schema.Number,
  overlapLines: Schema.Number,
  chunkConcurrency: Schema.optionalWith(Schema.Number, { exact: true }),
  skipExtensions: Schema.Array(Schema.String),
  ignoredPaths: Schema.Array(Schema.String),
  ignoreGitignore: Schema.optionalWith(Schema.Boolean, { exact: true }),
  embedder: EmbedderConfigSchema,
})

/** Domain config type inferred from ConfigSchema. */
export type Config = typeof ConfigSchema.Type

export const DEFAULT_CONFIG: Config = {
  schema: "1",
  chunkLines: 60,
  overlapLines: 10,
  chunkConcurrency: 8,
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
  embedder: {
    model: "Xenova/all-MiniLM-L6-v2",
    device: "auto",
    dtype: "fp32",
    batchSize: 16,
  },
}
