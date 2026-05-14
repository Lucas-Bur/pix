import { Data } from "effect"

export class ConfigError extends Data.TaggedError("ConfigError")<{
  readonly message: string
  readonly cause?: unknown
}> {}

export interface Config {
  readonly schema: string
  readonly model: string
  readonly dims: number
  readonly chunkLines: number
  readonly overlapLines: number
  readonly chunkConcurrency?: number
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
