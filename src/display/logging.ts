import { DateTime, Effect, Exit, Schema } from "effect"
import { FileSystem } from "effect/FileSystem"

import { DisplayLogError } from "../domain/errors.js"
import type { DisplayService, DisplayUpdatePayload } from "../domain/ports.js"
import { isPlatformReason } from "../lib/errors/platform-error.js"
import { payloadText } from "./interactive-state.js"

const LOG_DIR = ".pix/logs"
const LOG_FILE = `${LOG_DIR}/events.jsonl`
const JsonStringSchema = Schema.fromJsonString(Schema.Unknown)

const toLogError =
  (operation: string, path?: string) =>
  (cause: unknown): DisplayLogError => {
    if (isPlatformReason(cause, "BadResource")) {
      return new DisplayLogError({ message: `Disk full during ${operation}`, path, cause })
    }
    const msg = isPlatformReason(cause, "NotFound")
      ? `Path not found during ${operation}`
      : `Failed to ${operation}`
    return new DisplayLogError({ message: msg, path, cause })
  }

const withLogError = <A>(
  op: Effect.Effect<A, unknown>,
  operation: string,
  path?: string,
): Effect.Effect<A, DisplayLogError> => op.pipe(Effect.mapError(toLogError(operation, path)))

export const appendLogEntry = (
  fs: typeof FileSystem.Service,
  entry: Record<string, unknown>,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    const dirExists = yield* withLogError(fs.exists(LOG_DIR), "check log dir", LOG_DIR)
    if (!dirExists)
      yield* withLogError(fs.makeDirectory(LOG_DIR, { recursive: true }), "create log dir", LOG_DIR)
    const timestamp = DateTime.formatIso(yield* DateTime.now)
    const encoded = yield* Schema.encodeEffect(JsonStringSchema)({ timestamp, ...entry })
    const line = encoded + "\n"
    yield* withLogError(
      fs.writeFileString(LOG_FILE, line, { flag: "a" }),
      "append log entry",
      LOG_FILE,
    )
  }).pipe(Effect.catch((err) => Effect.logError(err).pipe(Effect.as(void 0))))

export const withLoggedEffect = <A, E, R>(
  fs: typeof FileSystem.Service,
  effect: Effect.Effect<A, E, R>,
  startEntry: Record<string, unknown>,
  stopEntry: Record<string, unknown>,
): Effect.Effect<A, E, R> =>
  Effect.gen(function* () {
    yield* appendLogEntry(fs, startEntry)
    const exit = yield* Effect.exit(effect)
    yield* appendLogEntry(fs, stopEntry)
    if (Exit.isSuccess(exit)) return exit.value
    return yield* Effect.failCause(exit.cause)
  })

export const makeJsonHandler =
  (fs: typeof FileSystem.Service): DisplayService["json"] =>
  (data) =>
    appendLogEntry(fs, { type: "json" }).pipe(
      Effect.andThen(Schema.encodeEffect(JsonStringSchema)(data).pipe(Effect.orDie)),
      Effect.andThen((encoded) => Effect.sync(() => process.stdout.write(`${encoded}\n`))),
    )

export const updatePayloadLog = (payload: DisplayUpdatePayload): Record<string, unknown> => ({
  type: "update",
  message: payloadText(payload),
  advanceBy: typeof payload === "string" ? undefined : payload.advanceBy,
  setTo: typeof payload === "string" ? undefined : payload.setTo,
  setToPercent: typeof payload === "string" ? undefined : payload.setToPercent,
})
