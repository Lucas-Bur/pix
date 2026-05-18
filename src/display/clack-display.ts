import { styleText } from "node:util"

import * as clack from "@clack/prompts"
import { FileSystem } from "@effect/platform"
import { Effect, Layer, Ref, Exit } from "effect"

import {
  Display,
  type DisplayService,
  type DisplaySeverity,
  type DisplayProgressOptions as ProgressOptions,
  type DisplayUpdatePayload,
} from "../domain/ports.js"
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
import { appendLogEntry, updatePayloadLog } from "./logging.js"

const severityToClack: Record<DisplaySeverity, (message: string) => void> = {
  info: clack.log.info,
  success: clack.log.success,
  warn: clack.log.warning,
  error: clack.log.error,
}

const terminalStyle = {
  status: (message: string): string => styleText("bold", message),
  dim: (message: string): string => styleText("dim", message),
}

type ClackHandle =
  | { readonly type: "spinner"; readonly handle: ReturnType<typeof clack.spinner> }
  | { readonly type: "progress"; readonly handle: ReturnType<typeof clack.progress> }

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

const dismissSpinnerAndStop = (
  fs: FileSystem.FileSystem,
  activeRef: Ref.Ref<ActiveInteractive>,
  handleRef: Ref.Ref<ClackHandle | null>,
  lastSpinnerMsg: Ref.Ref<string>,
  fallbackMsg: string,
): Effect.Effect<boolean> =>
  Effect.gen(function* () {
    const wasSpinner = yield* dismissSpinner(activeRef)
    if (!wasSpinner) return false
    const h = yield* Ref.get(handleRef)
    if (h && h.type === "spinner") {
      const msg = yield* Ref.get(lastSpinnerMsg)
      h.handle.stop(msg || fallbackMsg)
      yield* Ref.set(handleRef, null)
    }
    return true
  })

const runWithProgressBar = <A, E, R>(
  fs: FileSystem.FileSystem,
  opts: ProgressOptions,
  effect: Effect.Effect<A, E, R>,
  activeRef: Ref.Ref<ActiveInteractive>,
  handleRef: Ref.Ref<ClackHandle | null>,
): Effect.Effect<A, E, R> =>
  Effect.gen(function* () {
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
  })

export const ClackDisplayLive = Layer.effect(
  Display,
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const activeRef = yield* Ref.make<ActiveInteractive>(null)
    const handleRef = yield* Ref.make<ClackHandle | null>(null)
    const lastSpinnerMsg = yield* Ref.make<string>("")

    const dismissSpinnerToProgress = (msg: string) =>
      dismissSpinnerAndStop(fs, activeRef, handleRef, lastSpinnerMsg, msg)

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

      spinner: <A, E, R>(message: string, effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
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
          yield* dismissSpinnerToProgress(opts.message)
          return yield* runWithProgressBar(fs, opts, effect, activeRef, handleRef)
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

      json: () => appendLogEntry(fs, { type: "json" }),
    } satisfies DisplayService
  }),
)
