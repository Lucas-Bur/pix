import { Data } from "effect"

export class ConfigError extends Data.TaggedError("ConfigError")<{
  readonly message: string
  readonly cause?: unknown
}> {}

/** Pix project configuration stored in .pix/config.json. */
export interface Config {
  /** Config schema version. */
  readonly schema: string
  /** HuggingFace model identifier for embeddings. */
  readonly model: string
  /** Embedding vector dimensions. */
  readonly dims: number
  /** Number of source lines per chunk. */
  readonly chunkLines: number
  /** Number of overlapping lines between consecutive chunks. */
  readonly overlapLines: number
  /**
   * Maximum concurrent file-chunking operations during indexing. Clamped to minimum 1 by the index
   * pipeline. Defaults to 8 when absent.
   */
  readonly chunkConcurrency?: number
  /** File extensions to index, mapped to priority weight. */
  readonly files: Record<string, number>
}

/** Default file extensions to index. Whitelist approach. */
export const DEFAULT_EXTENSIONS = [
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".py",
  ".rs",
  ".go",
  ".java",
  ".c",
  ".cpp",
  ".h",
] as const

export const DEFAULT_CONFIG: Config = {
  schema: "1",
  model: "Xenova/all-MiniLM-L6-v2",
  dims: 384,
  chunkLines: 60,
  overlapLines: 10,
  chunkConcurrency: 8,
  files: {},
}
