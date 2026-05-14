import { Data } from "effect"

// === Config errors ===

/** Config file or directory does not exist. Run pix init first. */
export class ConfigNotFoundError extends Data.TaggedError("ConfigNotFoundError")<{
  readonly message: string
  readonly path?: string
  readonly cause?: unknown
}> {}

/** Config file exists but contains invalid JSON. */
export class ConfigMalformedError extends Data.TaggedError("ConfigMalformedError")<{
  readonly message: string
  readonly path?: string
  readonly cause?: unknown
}> {}

// === Index store errors ===

/** Index files (chunks.jsonl, vectors.bin) do not exist. Run pix index first. */
export class NoIndexError extends Data.TaggedError("NoIndexError")<{
  readonly message: string
}> {}

/** Disk is full — write operation could not complete. */
export class DiskFullError extends Data.TaggedError("DiskFullError")<{
  readonly message: string
  readonly path?: string
  readonly cause?: unknown
}> {}

/** Generic index store I/O failure (read, write, delete). */
export class StoreError extends Data.TaggedError("StoreError")<{
  readonly message: string
  readonly path?: string
  readonly cause?: unknown
}> {}

// === Processing errors ===

/** Source file could not be read during chunking (binary, permissions, encoding). */
export class ChunkerError extends Data.TaggedError("ChunkerError")<{
  readonly message: string
  readonly file: string
  readonly cause?: unknown
}> {}

/** Embedding model could not be downloaded or loaded. */
export class ModelLoadError extends Data.TaggedError("ModelLoadError")<{
  readonly message: string
  readonly model: string
  readonly cause?: unknown
}> {}

/** Embedding model failed during inference. */
export class InferenceError extends Data.TaggedError("InferenceError")<{
  readonly message: string
  readonly cause?: unknown
}> {}

/**
 * Fatal scan failure — gitignore loading failed entirely. Non-fatal per-entry skips are reported
 * via ScanResult.skipped.
 */
export class ScanFailed extends Data.TaggedError("ScanFailed")<{
  readonly message: string
  readonly cause?: unknown
}> {}

// === Error union types ===

import type { ConfigError } from "./config.js"

/** All config-related error types. */
export type AllConfigErrors = ConfigError | ConfigNotFoundError | ConfigMalformedError

/** All index store error types. */
export type AllStoreErrors = StoreError | DiskFullError | NoIndexError

/** All embedder error types. */
export type AllEmbedderErrors = ModelLoadError | InferenceError
