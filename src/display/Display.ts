import { styleText } from "node:util"

import * as clack from "@clack/prompts"
import { Context, Data, Effect, Layer, Ref, Exit } from "effect"

import {
  type ActiveInteractive,
  type ProgressOptions,
  type UpdateInteractivePayload,
  clearActive,
  computeDelta,
  dismissSpinner,
  getActive,
  payloadText,
  setActive,
  updateProgressValue,
} from "./interactive-state.js"

/** Severity level for log messages */
export type Severity = "info" | "success" | "warn" | "error"

/** Union of all display entries recorded by SilentDisplay for test assertions */
export type DisplayEntry = Data.TaggedEnum<{
  readonly intro: { readonly title: string }
  readonly outro: { readonly message: string }
  readonly log: { readonly message: string; readonly severity: Severity }
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

/** Display service — abstracts CLI output behind structured methods */
interface DisplayService {
  readonly intro: (title: string) => Effect.Effect<void>
  readonly outro: (message: string) => Effect.Effect<void>
  readonly log: (message: string, severity: Severity) => Effect.Effect<void>
  readonly note: (content: string, title?: string) => Effect.Effect<void>
  readonly text: (message: string) => Effect.Effect<void>
  /**
   * Wrap an effect with a spinner lifecycle. Inner effects can call d.updateInteractive() for
   * updates.
   */
  readonly spinner: <A, E, R>(
    message: string,
    effect: Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E, R>
  /**
   * Wrap an effect with a progress bar lifecycle. Inner effects can call d.updateInteractive() for
   * updates.
   */
  readonly progress: <A, E, R>(
    opts: ProgressOptions,
    effect: Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E, R>
  /** Update active spinner/progress text and optionally advance the progress bar. */
  readonly updateInteractive: (payload: UpdateInteractivePayload) => Effect.Effect<void>
  readonly json: (data: unknown) => Effect.Effect<void>
}

/** Display context tag — commands use `yield* Display` to produce output */
export class Display extends Context.Tag("Display")<Display, DisplayService>() {}

/** Maps severity to the corresponding @clack/prompts log function */
const severityToClack: Record<Severity, (message: string) => void> = {
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

/** Display implementation using @clack/prompts for interactive terminal output */
export const ClackDisplay = {
  layer: Layer.effect(
    Display,
    Effect.gen(function* () {
      const activeRef = yield* Ref.make<ActiveInteractive>(null)
      const handleRef = yield* Ref.make<ClackHandle | null>(null)
      const lastSpinnerMsg = yield* Ref.make<string>("")

      return {
        intro: (title) => Effect.sync(() => clack.intro(styleText("inverse", ` ${title} `))),

        outro: (message) => Effect.sync(() => clack.outro(message)),

        log: (message, severity) =>
          Effect.sync(() => severityToClack[severity](terminalStyle.status(message))),

        note: (content, title) => Effect.sync(() => clack.note(content, title)),

        text: (message) => Effect.sync(() => clack.log.message(message)),

        spinner: <A, E, R>(
          message: string,
          effect: Effect.Effect<A, E, R>,
        ): Effect.Effect<A, E, R> =>
          Effect.gen(function* () {
            const current = yield* getActive(activeRef)
            if (current !== null) return yield* effect
            const s = clack.spinner()
            s.start(message)
            yield* setActive(activeRef, { type: "spinner" })
            yield* Ref.set(handleRef, { type: "spinner", handle: s } as ClackHandle)
            yield* Ref.set(lastSpinnerMsg, message)
            const exit = yield* Effect.exit(effect)
            const lastMsg = yield* Ref.get(lastSpinnerMsg)
            s.stop(exit._tag === "Success" && lastMsg ? lastMsg : `${message} (failed)`)
            yield* Ref.set(handleRef, null)
            yield* clearActive(activeRef)
            if (Exit.isSuccess(exit)) return exit.value
            return yield* Effect.failCause(exit.cause)
          }),

        progress: <A, E, R>(
          opts: ProgressOptions,
          effect: Effect.Effect<A, E, R>,
        ): Effect.Effect<A, E, R> =>
          Effect.gen(function* () {
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
            if (Exit.isSuccess(exit)) {
              bar.stop(opts.message)
              return exit.value
            }
            bar.error(opts.message)
            return yield* Effect.failCause(exit.cause)
          }),

        updateInteractive: (payload) =>
          Effect.gen(function* () {
            const active = yield* getActive(activeRef)
            if (!active) return
            const h = yield* Ref.get(handleRef)
            if (!h) return
            if (active.type === "spinner" && h.type === "spinner") {
              const msg = payloadText(payload)
              h.handle.message(msg)
              yield* Ref.set(lastSpinnerMsg, msg)
              return
            }
            if (active.type === "progress" && h.type === "progress") {
              const delta = computeDelta(payload, { value: active.value, max: active.max })
              const newValue = Math.max(0, Math.min(active.max, active.value + delta))
              h.handle.advance(delta, payloadText(payload))
              yield* updateProgressValue(activeRef, newValue)
            }
          }),

        json: () => Effect.void,
      }
    }),
  ),
}

/** Display implementation for --json mode — no-ops interactive methods, writes JSON to stdout */
export const JsonDisplay = {
  layer: Layer.succeed(Display, {
    intro: () => Effect.void,
    outro: () => Effect.void,
    log: () => Effect.void,
    note: () => Effect.void,
    text: () => Effect.void,
    spinner: <A, E, R>(_message: string, effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
      effect,
    progress: <A, E, R>(
      _opts: ProgressOptions,
      effect: Effect.Effect<A, E, R>,
    ): Effect.Effect<A, E, R> => effect,
    updateInteractive: () => Effect.void,
    json: (data) => Effect.sync(() => process.stdout.write(`${JSON.stringify(data)}\n`)),
  }),
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
