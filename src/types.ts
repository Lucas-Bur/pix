/**
 * Runtime configuration stored in `.pix/config.json`.
 *
 * @property schema - Config schema version. "1" = MVP schema. Bump when config format changes to
 *   allow migration logic.
 * @property model - ONNX model name for embeddings (Xenova format).
 * @property dims - Embedding vector dimensions (384 for all-MiniLM-L6-v2).
 * @property chunkLines - Number of lines per chunk (default 60). Controls granularity of code
 *   indexing.
 * @property overlapLines - Overlapping lines between consecutive chunks (default 10). Preserves
 *   context across chunk boundaries.
 * @property files - Mtime cache for incremental indexing (Phase 3). Maps file path to last-modified
 *   timestamp. Empty `{}` for MVP (no incremental indexing yet).
 */
export interface Config {
  schema: string
  model: string
  dims: number
  chunkLines: number
  overlapLines: number
  files: Record<string, number>
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

/** Default config values for `pix init`. */
export const DEFAULT_CONFIG: Config = {
  schema: "1",
  model: "Xenova/all-MiniLM-L6-v2",
  dims: 384,
  chunkLines: 60,
  overlapLines: 10,
  files: {},
}
