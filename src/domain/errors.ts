import { Data, Schema } from "effect"

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

/** No active SQLite index snapshot exists. Run pix index first. */
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

/** Input or batch exceeded a model-aware token budget before inference. */
export class TokenLimitError extends Data.TaggedError("TokenLimitError")<{
  readonly message: string
  readonly model: string
  readonly actualTokens: number
  readonly limit: number
  readonly scope: "input" | "batch"
}> {}

/** A source chunk could not be safely split below the configured token limit. */
export class OversizedChunkError extends Data.TaggedError("OversizedChunkError")<{
  readonly message: string
  readonly file: string
  readonly startLine: number
  readonly endLine: number
  readonly model: string
  readonly actualTokens: number
  readonly limit: number
}> {}

// === Chunk validation error ===

/** Persisted chunk data failed schema validation. */
export class ChunkValidationError extends Data.TaggedError("ChunkValidationError")<{
  readonly message: string
  readonly errors: ReadonlyArray<{
    readonly path: string
    readonly message: string
  }>
}> {}

/** Runtime schema for serializing persisted chunk validation failures. */
export const ChunkValidationErrorSchema = Schema.TaggedStruct("ChunkValidationError", {
  message: Schema.String,
  errors: Schema.Array(Schema.Struct({ path: Schema.String, message: Schema.String })),
})

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
export type AllEmbedderErrors = ModelLoadError | InferenceError | TokenLimitError

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
  | AllEmbedderErrors
  | AllProcessorErrors
  | OversizedChunkError
  | StoreError
  | DiskFullError

// === Display log errors ===

/** Structured file logging failed (write, mkdir, permission). */
export class DisplayLogError extends Data.TaggedError("DisplayLogError")<{
  readonly message: string
  readonly path?: string
  readonly cause?: unknown
}> {}

/** Copying text to the system clipboard failed. */
export class ClipboardError extends Data.TaggedError("ClipboardError")<{
  readonly message: string
  readonly cause?: unknown
}> {}

/** Query alias registry operation failed. */
export class AliasStoreError extends Data.TaggedError("AliasStoreError")<{
  readonly message: string
  readonly path?: string
  readonly cause?: unknown
}> {}

/** Query alias name or stored data is invalid. */
export class AliasValidationError extends Data.TaggedError("AliasValidationError")<{
  readonly message: string
  readonly name?: string
}> {}

/** Requested query alias does not exist. */
export class AliasNotFoundError extends Data.TaggedError("AliasNotFoundError")<{
  readonly message: string
  readonly name: string
}> {}
