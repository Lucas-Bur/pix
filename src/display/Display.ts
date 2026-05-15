import { styleText } from "node:util"

import * as clack from "@clack/prompts"
import { Context, Data, Effect, Layer, Ref } from "effect"

/** Severity level for log messages */
export type Severity = "info" | "success" | "warn" | "error"

/** Options for the progress bar method */
type ProgressOptions = {
  readonly message: string
  readonly max: number
  readonly style?: "light" | "heavy" | "block"
  readonly size?: number
  readonly indicator?: "dots" | "timer"
}

/** Payload for d.updateInteractive() — plain string updates text only, object adds position control */
type UpdateInteractivePayload =
  | string
  | {
      readonly message: string
      readonly advanceBy?: never
      readonly setTo?: never
      readonly setToPercent?: never
    }
  | {
      readonly message: string
      readonly advanceBy: number
      readonly setTo?: never
      readonly setToPercent?: never
    }
  | {
      readonly message: string
      readonly setTo: number
      readonly advanceBy?: never
      readonly setToPercent?: never
    }
  | {
      readonly message: string
      readonly setToPercent: number
      readonly advanceBy?: never
      readonly setTo?: never
    }

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

/**
 * Active interactive element. @clack supports only one interactive line at a time (spinner or
 * progress bar). State is tracked immutably inside a Ref scoped to the layer lifecycle.
 */
type ActiveInteractive =
  | { readonly type: "spinner"; readonly handle: ReturnType<typeof clack.spinner> }
  | {
      readonly type: "progress"
      readonly handle: ReturnType<typeof clack.progress>
      readonly value: number
      readonly max: number
    }
  | null

/** Extract the message text from an UpdateInteractivePayload */
const payloadText = (p: UpdateInteractivePayload): string => (typeof p === "string" ? p : p.message)

/**
 * Compute the delta for a progress bar from the payload + current state. Returns 0 if there is no
 * numeric payload or if the active element is a spinner.
 */
const computeDelta = (
  p: UpdateInteractivePayload,
  state: { readonly value: number; readonly max: number },
): number => {
  if (typeof p === "string") return 0
  if ("advanceBy" in p && p.advanceBy !== undefined) {
    return Math.max(-state.value, p.advanceBy)
  }
  if ("setTo" in p && p.setTo !== undefined) {
    const target = Math.max(0, Math.min(state.max, p.setTo))
    return target - state.value
  }
  if ("setToPercent" in p && p.setToPercent !== undefined) {
    const target = Math.floor((state.max * p.setToPercent) / 100)
    return Math.max(-state.value, Math.min(state.max - state.value, target - state.value))
  }
  return 0
}

/** Display implementation using @clack/prompts for interactive terminal output */
export const ClackDisplay = {
  layer: Layer.effect(
    Display,
    Effect.gen(function* () {
      const activeRef = yield* Ref.make<ActiveInteractive>(null)

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
          Ref.get(activeRef).pipe(
            Effect.flatMap((current) =>
              current !== null
                ? effect
                : Effect.acquireUseRelease(
                    Effect.sync(() => {
                      const s = clack.spinner()
                      s.start(message)
                      return s
                    }).pipe(Effect.tap((s) => Ref.set(activeRef, { type: "spinner", handle: s }))),
                    () => effect,
                    (s, exit) =>
                      Ref.set(activeRef, null).pipe(
                        Effect.andThen(
                          Effect.sync(() => {
                            if (exit._tag === "Success") {
                              s.stop(message)
                            } else {
                              s.stop(`${message} (failed)`)
                            }
                          }),
                        ),
                      ),
                  ),
            ),
          ),

        progress: <A, E, R>(
          opts: ProgressOptions,
          effect: Effect.Effect<A, E, R>,
        ): Effect.Effect<A, E, R> =>
          Ref.get(activeRef).pipe(
            Effect.flatMap((current) =>
              current !== null
                ? effect
                : Effect.acquireUseRelease(
                    Effect.sync(() => {
                      const bar = clack.progress({
                        max: opts.max,
                        style: opts.style ?? "heavy",
                        size: opts.size ?? 40,
                        indicator: opts.indicator ?? "dots",
                      })
                      bar.start(opts.message)
                      return bar
                    }).pipe(
                      Effect.tap((bar) =>
                        Ref.set(activeRef, {
                          type: "progress",
                          handle: bar,
                          value: 0,
                          max: opts.max,
                        }),
                      ),
                    ),
                    () => effect,
                    (bar, exit) =>
                      Ref.set(activeRef, null).pipe(
                        Effect.andThen(
                          Effect.sync(() => {
                            if (exit._tag === "Success") {
                              bar.stop(opts.message)
                            } else {
                              bar.error(opts.message)
                            }
                          }),
                        ),
                      ),
                  ),
            ),
          ),

        updateInteractive: (payload) =>
          Ref.get(activeRef).pipe(
            Effect.flatMap((active) => {
              if (!active) return Effect.void
              if (active.type === "spinner") {
                return Effect.sync(() => active.handle.message(payloadText(payload)))
              }
              const delta = computeDelta(payload, { value: active.value, max: active.max })
              const newValue = Math.max(0, Math.min(active.max, active.value + delta))
              return Effect.sync(() => {
                active.handle.advance(delta, payloadText(payload))
              }).pipe(
                Effect.andThen(
                  Ref.update(activeRef, (current) =>
                    current && current.type === "progress"
                      ? { ...current, value: newValue }
                      : current,
                  ),
                ),
              )
            }),
          ),

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

      updateInteractive: (payload) => {
        const msg = payloadText(payload)
        if (typeof payload === "string") {
          return Ref.update(ref, (entries) => [
            ...entries,
            DisplayEntry.updateInteractive({ message: msg }),
          ])
        }
        const entry = DisplayEntry.updateInteractive({
          message: msg,
          ...("advanceBy" in payload &&
            payload.advanceBy !== undefined && { advanceBy: payload.advanceBy }),
          ...("setTo" in payload && payload.setTo !== undefined && { setTo: payload.setTo }),
          ...("setToPercent" in payload &&
            payload.setToPercent !== undefined && { setToPercent: payload.setToPercent }),
        })
        return Ref.update(ref, (entries) => [...entries, entry])
      },

      json: (data) => Ref.update(ref, (entries) => [...entries, DisplayEntry.json({ data })]),
    }),
}
