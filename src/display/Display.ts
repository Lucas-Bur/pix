import { styleText } from "node:util"

import * as clack from "@clack/prompts"
import { FileSystem } from "@effect/platform"
import { Data, Effect, Layer, Ref, Exit } from "effect"

import { DisplayLogError } from "../domain/errors.js"
import {
  Display,
  type DisplayService,
  type DisplaySeverity,
  type DisplayProgressOptions as ProgressOptions,
  type DisplayUpdatePayload,
} from "../domain/ports.js"
import { isPlatformReason } from "../lib/platform-error.js"
import {
  type ActiveInteractive,
  clearActive,
  computeDelta,
  dismissSpinner,
  getActive,
  payloadText,
  setActive,
  updateProgressValue,
} from "./interactive-state.js"

/** Create a shared json handler for Display implementations. */
const makeJsonHandler =
  (fs: typeof FileSystem.FileSystem.Service): DisplayService["json"] =>
  (data) =>
    appendLogEntry(fs, { type: "json" }).pipe(
      Effect.andThen(Effect.sync(() => process.stdout.write(`${JSON.stringify(data)}\n`))),
    )

/** Union of all display entries recorded by SilentDisplay for test assertions */
export type DisplayEntry = Data.TaggedEnum<{
  readonly intro: { readonly title: string }
  readonly outro: { readonly message: string }
  readonly log: { readonly message: string; readonly severity: DisplaySeverity }
  readonly note: { readonly content: string; readonly title?: string }
  readonly text: { readonly message: string }
  readonly spinner: { readonly message: string }
  readonly progress: { readonly message: string; readonly max: number }
  readonly updateInteractive: {
    readonly message: string
    readonly advanceBy?: number
    readonly setTo?: number
    readonly setToPercent?: number
  }
  readonly json: { readonly data: unknown }
}>

const DisplayEntry = Data.taggedEnum<DisplayEntry>()

const LOG_DIR = ".pix/logs"
const LOG_FILE = `${LOG_DIR}/events.jsonl`

/** Maps severity to the corresponding @clack/prompts log function */
const severityToClack: Record<DisplaySeverity, (message: string) => void> = {
  info: clack.log.info,
  success: clack.log.success,
  warn: clack.log.warning,
  error: clack.log.error,
}

/** Styling helpers using node:util styleText (zero-deps, Node 21+) */
const terminalStyle = {
  status: (message: string): string => styleText("bold", message),
  dim: (message: string): string => styleText("dim", message),
}

type ClackHandle =
  | { readonly type: "spinner"; readonly handle: ReturnType<typeof clack.spinner> }
  | { readonly type: "progress"; readonly handle: ReturnType<typeof clack.progress> }

/** Map a platform error to a domain-level DisplayLogError. */
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

/** Wrap any fs Effect so failures become DisplayLogError (logged, not thrown). */
const withLogError = <A>(
  op: Effect.Effect<A, unknown>,
  operation: string,
  path?: string,
): Effect.Effect<A, DisplayLogError> => op.pipe(Effect.mapError(toLogError(operation, path)))

/** Write a structured log entry to `.pix/logs/events.jsonl`. Errors are logged, not thrown. */
const appendLogEntry = (
  fs: typeof FileSystem.FileSystem.Service,
  entry: Record<string, unknown>,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    const dirExists = yield* withLogError(fs.exists(LOG_DIR), "check log dir", LOG_DIR)
    if (!dirExists)
      yield* withLogError(fs.makeDirectory(LOG_DIR, { recursive: true }), "create log dir", LOG_DIR)
    const line = JSON.stringify({ timestamp: new Date().toISOString(), ...entry }) + "\n"
    yield* withLogError(
      fs.writeFileString(LOG_FILE, line, { flag: "a" }),
      "append log entry",
      LOG_FILE,
    )
  }).pipe(Effect.catchAll((err) => Effect.logError(err).pipe(Effect.as(void 0))))

/** Wrap an effect with start/stop log entries, propagating success or failure */
const withLoggedEffect = <A, E, R>(
  fs: typeof FileSystem.FileSystem.Service,
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

/** Display implementation using @clack/prompts for interactive terminal output */
export const ClackDisplay = {
  layer: Layer.effect(
    Display,
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const activeRef = yield* Ref.make<ActiveInteractive>(null)
      const handleRef = yield* Ref.make<ClackHandle | null>(null)
      const lastSpinnerMsg = yield* Ref.make<string>("")

      return {
        intro: (title) =>
          appendLogEntry(fs, { type: "intro", title }).pipe(
            Effect.andThen(Effect.sync(() => clack.intro(styleText("inverse", ` ${title} `)))),
          ),

        outro: (message) =>
          appendLogEntry(fs, { type: "outro", message }).pipe(
            Effect.andThen(Effect.sync(() => clack.outro(message))),
          ),

        log: (message, severity) =>
          appendLogEntry(fs, { severity, message }).pipe(
            Effect.andThen(
              Effect.sync(() => severityToClack[severity](terminalStyle.status(message))),
            ),
          ),

        note: (content, title) =>
          appendLogEntry(fs, { type: "note", content, title }).pipe(
            Effect.andThen(Effect.sync(() => clack.note(content, title))),
          ),

        text: (message) =>
          appendLogEntry(fs, { type: "text", message }).pipe(
            Effect.andThen(Effect.sync(() => clack.log.message(message))),
          ),

        spinner: <A, E, R>(
          message: string,
          effect: Effect.Effect<A, E, R>,
        ): Effect.Effect<A, E, R> =>
          Effect.gen(function* () {
            const current = yield* getActive(activeRef)
            if (current !== null) return yield* effect
            yield* appendLogEntry(fs, { type: "spinner-start", message })
            const s = clack.spinner()
            s.start(message)
            yield* setActive(activeRef, { type: "spinner" })
            yield* Ref.set(handleRef, { type: "spinner", handle: s } satisfies ClackHandle)
            yield* Ref.set(lastSpinnerMsg, message)
            const exit = yield* Effect.exit(effect)
            const lastMsg = yield* Ref.get(lastSpinnerMsg)
            s.stop(exit._tag === "Success" && lastMsg ? lastMsg : `${message} (failed)`)
            yield* Ref.set(handleRef, null)
            yield* clearActive(activeRef)
            yield* appendLogEntry(fs, { type: "spinner-stop" })
            if (Exit.isSuccess(exit)) return exit.value
            return yield* Effect.failCause(exit.cause)
          }),

        progress: <A, E, R>(
          opts: ProgressOptions,
          effect: Effect.Effect<A, E, R>,
        ): Effect.Effect<A, E, R> =>
          Effect.gen(function* () {
            yield* appendLogEntry(fs, {
              type: "progress-start",
              message: opts.message,
              max: opts.max,
            })
            const wasSpinner = yield* dismissSpinner(activeRef)
            if (wasSpinner) {
              const h = yield* Ref.get(handleRef)
              if (h && h.type === "spinner") {
                const msg = yield* Ref.get(lastSpinnerMsg)
                h.handle.stop(msg || opts.message)
                yield* Ref.set(handleRef, null)
              }
            }
            const bar = clack.progress({
              max: opts.max,
              style: opts.style ?? "heavy",
              size: opts.size ?? 40,
              indicator: opts.indicator ?? "dots",
            })
            bar.start(opts.message)
            yield* setActive(activeRef, { type: "progress", value: 0, max: opts.max })
            yield* Ref.set(handleRef, { type: "progress", handle: bar })
            const exit = yield* Effect.exit(effect)
            yield* clearActive(activeRef)
            yield* Ref.set(handleRef, null)
            yield* appendLogEntry(fs, { type: "progress-stop" })
            if (Exit.isSuccess(exit)) {
              bar.stop(opts.message)
              return exit.value
            }
            bar.error(opts.message)
            return yield* Effect.failCause(exit.cause)
          }),

        updateInteractive: (payload) =>
          Effect.gen(function* () {
            yield* appendLogEntry(fs, updatePayloadLog(payload))
            const active = yield* getActive(activeRef)
            if (!active) return
            const h = yield* Ref.get(handleRef)
            if (!h) return
            if (active.type === "spinner" && h.type === "spinner") {
              return yield* updateSpinnerMessage(payload, h, lastSpinnerMsg)
            }
            if (active.type === "progress" && h.type === "progress") {
              return yield* updateProgressBar(payload, active, h, activeRef)
            }
          }),

        json: makeJsonHandler(fs),
      } satisfies DisplayService
    }),
  ),
}

const updatePayloadLog = (payload: DisplayUpdatePayload): Record<string, unknown> => ({
  type: "update",
  message: payloadText(payload),
  advanceBy: typeof payload === "string" ? undefined : payload.advanceBy,
  setTo: typeof payload === "string" ? undefined : payload.setTo,
  setToPercent: typeof payload === "string" ? undefined : payload.setToPercent,
})

const updateSpinnerMessage = (
  payload: DisplayUpdatePayload,
  h: ClackHandle & { readonly type: "spinner" },
  lastSpinnerMsg: Ref.Ref<string>,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    const msg = payloadText(payload)
    h.handle.message(msg)
    yield* Ref.set(lastSpinnerMsg, msg)
  })

const updateProgressBar = (
  payload: DisplayUpdatePayload,
  active: ActiveInteractive & { readonly type: "progress" },
  h: ClackHandle & { readonly type: "progress" },
  activeRef: Ref.Ref<ActiveInteractive>,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    const delta = computeDelta(payload, { value: active.value, max: active.max })
    const newValue = Math.max(0, Math.min(active.max, active.value + delta))
    h.handle.advance(delta, payloadText(payload))
    yield* updateProgressValue(activeRef, newValue)
  })

/** Display implementation for --json mode — no-ops interactive methods, writes JSON to stdout */
export const JsonDisplay = {
  layer: Layer.effect(
    Display,
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      return {
        intro: (title) => appendLogEntry(fs, { type: "intro", title }),
        outro: (message) => appendLogEntry(fs, { type: "outro", message }),
        log: (message, severity) => appendLogEntry(fs, { severity, message }),
        note: (content, title) => appendLogEntry(fs, { type: "note", content, title }),
        text: (message) => appendLogEntry(fs, { type: "text", message }),
        spinner: <A, E, R>(
          message: string,
          effect: Effect.Effect<A, E, R>,
        ): Effect.Effect<A, E, R> =>
          withLoggedEffect(
            fs,
            effect,
            { type: "spinner-start", message },
            { type: "spinner-stop" },
          ),
        progress: <A, E, R>(
          opts: ProgressOptions,
          effect: Effect.Effect<A, E, R>,
        ): Effect.Effect<A, E, R> =>
          withLoggedEffect(
            fs,
            effect,
            { type: "progress-start", message: opts.message, max: opts.max },
            { type: "progress-stop" },
          ),
        updateInteractive: (payload) => appendLogEntry(fs, updatePayloadLog(payload)),
        json: makeJsonHandler(fs),
      } satisfies DisplayService
    }),
  ),
}

/**
 * Display implementation that records all calls to a Ref for test assertions. Spinner and progress
 * are recorded on entry (before the wrapped effect runs) for reliable test assertions.
 */
export const SilentDisplay = {
  layer: (ref: Ref.Ref<ReadonlyArray<DisplayEntry>>): Layer.Layer<Display> =>
    Layer.succeed(Display, {
      intro: (title) => Ref.update(ref, (entries) => [...entries, DisplayEntry.intro({ title })]),

      outro: (message) =>
        Ref.update(ref, (entries) => [...entries, DisplayEntry.outro({ message })]),

      log: (message, severity) =>
        Ref.update(ref, (entries) => [...entries, DisplayEntry.log({ message, severity })]),

      note: (content, title) =>
        Ref.update(ref, (entries) => [...entries, DisplayEntry.note({ content, title })]),

      text: (message) => Ref.update(ref, (entries) => [...entries, DisplayEntry.text({ message })]),

      spinner: <A, E, R>(message: string, effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
        Ref.update(ref, (entries) => [...entries, DisplayEntry.spinner({ message })]).pipe(
          Effect.andThen(effect),
        ),

      progress: <A, E, R>(
        opts: ProgressOptions,
        effect: Effect.Effect<A, E, R>,
      ): Effect.Effect<A, E, R> =>
        Ref.update(ref, (entries) => [
          ...entries,
          DisplayEntry.progress({ message: opts.message, max: opts.max }),
        ]).pipe(Effect.andThen(effect)),

      updateInteractive: (payload) =>
        Ref.update(ref, (entries) => [
          ...entries,
          typeof payload === "string"
            ? DisplayEntry.updateInteractive({ message: payload })
            : DisplayEntry.updateInteractive({
                message: payload.message,
                advanceBy: "advanceBy" in payload ? payload.advanceBy : undefined,
                setTo: "setTo" in payload ? payload.setTo : undefined,
                setToPercent: "setToPercent" in payload ? payload.setToPercent : undefined,
              }),
        ]),

      json: (data) => Ref.update(ref, (entries) => [...entries, DisplayEntry.json({ data })]),
    }),
}

// Re-export for backward compatibility
export { Display }
