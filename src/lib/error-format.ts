import { Console, Effect } from "effect"

/**
 * Maps Data.TaggedError _tag values to JSON error codes for structured output. Used by formatError
 * to produce the spec-mandated `{ error: true, code, message }` format.
 */
const errorCodes: Record<string, string> = {
  ConfigError: "CONFIG_ERROR",
  ConfigNotFoundError: "CONFIG_NOT_FOUND",
  ConfigMalformedError: "CONFIG_MALFORMED",
  NoIndexError: "NO_INDEX",
  DiskFullError: "DISK_FULL",
  StoreError: "STORE_ERROR",
  ChunkerError: "CHUNK_ERROR",
  ModelLoadError: "MODEL_LOAD_ERROR",
  InferenceError: "INFERENCE_ERROR",
  ScanFailed: "SCAN_FAILED",
}

const messageFromError = (error: unknown): string => {
  if (typeof error === "string") return error
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message: unknown }).message)
  }
  return "Unknown error"
}

const codeFromError = (error: unknown): string => {
  if (error && typeof error === "object" && "_tag" in error) {
    const tag = String((error as { _tag: unknown })._tag)
    return errorCodes[tag] ?? "UNKNOWN"
  }
  return "UNKNOWN"
}

/** Format an error as spec-mandated JSON: `{ error: true, code: "...", message: "..." }`. */
export const formatError = (error: unknown): string =>
  JSON.stringify({
    error: true,
    code: codeFromError(error),
    message: messageFromError(error),
  })

/** Log the error as JSON to stdout, then re-fail to preserve non-zero exit code. */
export const reportError = <E>(error: E): Effect.Effect<never, E> =>
  Console.log(formatError(error)).pipe(Effect.flatMap(() => Effect.fail(error)))
