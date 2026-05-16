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

const causeFromError = (error: unknown): string => {
  if (typeof error === "string") return error
  if (error && typeof error === "object" && "cause" in error) {
    return String((error as { cause: unknown }).cause)
  }
  return "Unknown cause"
}

// TODO: there are more keys, that maybe need to be parsed. i think that we should go over each and every key in error object and try to parse it. if there is no function for that we display a message in log. a switch would be good for this exhaustive lookup
// some keys that i found so far: stack, model, file, path

export interface FormattedError {
  readonly error: true
  readonly code: string
  readonly message: string
  readonly cause: string
}

/** Format an error as spec-mandated JSON: `{ error: true, code: "...", message: "..." }`. */
export const formatError = (error: unknown): FormattedError => ({
  error: true,
  code: codeFromError(error),
  message: messageFromError(error),
  cause: causeFromError(error),
})

import { Effect } from "effect"

import { Display } from "../display/Display.js"

/** Log the error to Display in human + agent format, then re-fail to preserve non-zero exit code. */
export const reportError = <E>(error: E): Effect.Effect<never, E, Display> =>
  Effect.gen(function* () {
    const d = yield* Display
    yield* d.log(`${codeFromError(error)}: ${messageFromError(error)}`, "error")
    yield* d.json(formatError(error))
    return yield* Effect.fail(error)
  })
