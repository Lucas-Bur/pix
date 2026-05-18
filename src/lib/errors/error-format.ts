/**
 * Maps Data.TaggedError _tag values to JSON error codes for structured output. Used by formatError
 * to produce the spec-mandated `{ error: true, code, message }` format.
 */
const errorCodes: Record<string, string> = {
  ConfigError: "CONFIG_ERROR",
  ConfigNotFoundError: "CONFIG_NOT_FOUND",
  ConfigMalformedError: "CONFIG_MALFORMED",
  ConfigValidationError: "CONFIG_VALIDATION_ERROR",
  ChunkValidationError: "CHUNK_VALIDATION_ERROR",
  NoIndexError: "NO_INDEX",
  DiskFullError: "DISK_FULL",
  StoreError: "STORE_ERROR",
  ChunkerError: "CHUNK_ERROR",
  ModelLoadError: "MODEL_LOAD_ERROR",
  InferenceError: "INFERENCE_ERROR",
  DisplayLogError: "DISPLAY_LOG_ERROR",
  UnsupportedFormat: "UNSUPPORTED_FORMAT",
  ExtractionFailed: "EXTRACTION_FAILED",
}

export interface FormattedError {
  readonly error: true
  readonly code: string
  readonly message: string
  readonly cause: string
}

/**
 * Format an error as spec-mandated JSON: `{ error: true, code, message, cause }` with context
 * fields.
 */
export const formatError = (error: unknown): FormattedError => {
  if (typeof error === "string") {
    return { error: true, code: "STRING_ERROR", message: error, cause: "Unknown cause" }
  }
  if (!error || typeof error !== "object") {
    return { error: true, code: "UNKNOWN", message: "Unknown error", cause: "Unknown cause" }
  }

  const err = error as Record<string, unknown>
  const tag = typeof err._tag === "string" ? err._tag : "UNKNOWN"
  const message = typeof err.message === "string" ? err.message : "Unknown error"
  const cause = typeof err.cause === "string" ? err.cause : "Unknown cause"

  const context: Record<string, unknown> = {}
  if (typeof err.model === "string") context.model = err.model
  if (typeof err.file === "string") context.file = err.file
  if (typeof err.path === "string") context.path = err.path
  if (typeof err.stack === "string") context.stack = err.stack

  return {
    error: true,
    code: errorCodes[tag] ?? "UNKNOWN",
    message,
    cause,
    ...context,
  }
}

import { Effect } from "effect"

import { Display } from "../../domain/ports.js"

/** Log the error to Display in human + agent format, then re-fail to preserve non-zero exit code. */
export const reportError = <E>(error: E): Effect.Effect<never, E, Display> =>
  Effect.gen(function* () {
    const d = yield* Display
    const formatted = formatError(error)
    yield* d.log(`${formatted.code}: ${formatted.message}`, "error")
    yield* d.json(formatted)
    return yield* Effect.fail(error)
  })
