import { Data } from "effect"

// === Config errors ===

/** Generic config I/O failure (read, write, encode). */
export class ConfigError extends Data.TaggedError("ConfigError")<{
  readonly message: string
  readonly cause?: unknown
}> {}

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

/** Config failed schema validation — missing/invalid fields. */
export class ConfigValidationError extends Data.TaggedError("ConfigValidationError")<{
  readonly message: string
  readonly errors: ReadonlyArray<{
    readonly path: string
    readonly message: string
  }>
}> {}

/** Config has coupled-rule conflicts that require human/agent input to resolve (e.g. unknown model). */
export class ConfigHealError extends Data.TaggedError("ConfigHealError")<{
  readonly conflicts: ReadonlyArray<{
    readonly field: string
    readonly currentValue: string
    readonly validOptions: readonly string[]
    readonly reason: string
  }>
}> {}

/** Config model differs from the model the index was built with. Re-index required. */
export class ModelMismatchError extends Data.TaggedError("ModelMismatchError")<{
  readonly configModel: string
  readonly indexModel: string
}> {}

/** Interactive prompt was invoked in a non-interactive context (e.g. --json mode). */
export class InteractiveError extends Data.TaggedError("InteractiveError")<{
  readonly message: string
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

// === Chunk validation error ===

/** A chunk line in chunks.jsonl failed schema validation. */
export class ChunkValidationError extends Data.TaggedError("ChunkValidationError")<{
  readonly message: string
  readonly errors: ReadonlyArray<{
    readonly path: string
    readonly message: string
  }>
}> {}

// === Error union types ===

/** All config-related error types. */
export type AllConfigErrors =
  | ConfigError
  | ConfigNotFoundError
  | ConfigMalformedError
  | ConfigValidationError
  | ConfigHealError

/** All index store error types. */
export type AllStoreErrors = StoreError | DiskFullError | NoIndexError

/** All embedder error types. */
export type AllEmbedderErrors = ModelLoadError | InferenceError

// === Content extraction errors ===

/** File type is unsupported for text extraction. */
export class UnsupportedFormat extends Data.TaggedError("UnsupportedFormat")<{
  readonly message: string
  readonly extension: string
  readonly file?: string
}> {}

/** Text extraction failed for a supported file type. */
export class ExtractionFailed extends Data.TaggedError("ExtractionFailed")<{
  readonly message: string
  readonly file: string
  readonly cause?: unknown
}> {}

/** All content extraction error types. */
export type AllProcessorErrors = UnsupportedFormat | ExtractionFailed

/** All errors that can arise during indexing. */
export type IndexError =
  | AllConfigErrors
  | ChunkerError
  | AllEmbedderErrors
  | AllProcessorErrors
  | StoreError
  | DiskFullError

// === Display log errors ===

/** Structured file logging failed (write, mkdir, permission). */
export class DisplayLogError extends Data.TaggedError("DisplayLogError")<{
  readonly message: string
  readonly path?: string
  readonly cause?: unknown
}> {}
