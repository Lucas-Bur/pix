import { Data } from "effect"

export class ConfigError extends Data.TaggedError("ConfigError")<{
  readonly message: string
  readonly cause?: unknown
}> {}

/** Runtime settings for the embedding pipeline. */
export interface EmbedderConfig {
  /** HuggingFace model identifier. Must be a key in the model registry. */
  readonly model: string
  /** ONNX execution backend. auto picks the best available GPU backend. */
  readonly device: "auto" | "cpu" | "cuda" | "dml" | "coreml"
  /** Numerical precision for the model. Must be supported by the chosen model. */
  readonly dtype: "fp32" | "fp16" | "q8"
  /** Number of chunks to embed in a single batch. Controls GPU memory pressure. */
  readonly batchSize: number
}

/** Pix project configuration stored in .pix/config.json. */
export interface Config {
  /** Config schema version. */
  readonly schema: string
  /** Number of source lines per chunk. */
  readonly chunkLines: number
  /** Number of overlapping lines between consecutive chunks. */
  readonly overlapLines: number
  /**
   * Maximum concurrent file-chunking operations during indexing. Clamped to minimum 1 by the index
   * pipeline. Defaults to 8 when absent.
   */
  readonly chunkConcurrency?: number
  /** File extensions to skip during indexing. Overrides domain processor map. */
  readonly skipExtensions: readonly string[]
  /**
   * Gitignore-style patterns for directories and files to exclude from scanning. Merged with
   * .gitignore rules and ALWAYS_IGNORE. Supports glob patterns.
   */
  readonly ignoredPaths: readonly string[]
  /** Embedder runtime configuration. */
  readonly embedder: EmbedderConfig
}

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
    ".agents",
    ".claude",
    ".vscode",
    ".github",
    "coverage",
    "*-lock.yaml",
    "*-lock.json",
    "*.lock",
  ],
  embedder: {
    model: "Xenova/all-MiniLM-L6-v2",
    device: "auto",
    dtype: "fp32",
    batchSize: 16,
  },
}
