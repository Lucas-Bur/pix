import { styleText } from "node:util"

import * as clack from "@clack/prompts"
import { Context, Effect, Layer, Ref } from "effect"

/** Severity level for status messages */
export type Severity = "info" | "success" | "warn" | "error"

/** Options for the progress bar method */
export interface ProgressOptions {
  readonly message: string
  readonly max: number
  readonly style?: "light" | "heavy" | "block"
  readonly size?: number
  readonly indicator?: "dots" | "timer"
}

/** Union of all display entries recorded by SilentDisplay for test assertions */
export type DisplayEntry =
  | { readonly _tag: "intro"; readonly title: string }
  | { readonly _tag: "outro"; readonly message: string }
  | { readonly _tag: "status"; readonly message: string; readonly severity: Severity }
  | { readonly _tag: "note"; readonly content: string; readonly title?: string }
  | { readonly _tag: "text"; readonly message: string }
  | { readonly _tag: "spinner"; readonly message: string }
  | { readonly _tag: "progress"; readonly message: string; readonly max: number }
  | { readonly _tag: "message"; readonly message: string }
  | { readonly _tag: "json"; readonly data: unknown }

/** Display service — abstracts CLI output behind structured methods */
export interface DisplayService {
  readonly intro: (title: string) => Effect.Effect<void>
  readonly outro: (message: string) => Effect.Effect<void>
  readonly status: (message: string, severity: Severity) => Effect.Effect<void>
  readonly note: (content: string, title?: string) => Effect.Effect<void>
  readonly text: (message: string) => Effect.Effect<void>
  /** Wrap an effect with a spinner lifecycle. Inner effects can call d.message() for updates. */
  readonly spinner: <A, E, R>(
    message: string,
    effect: Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E, R>
  /** Wrap an effect with a progress bar lifecycle. Inner effects can call d.message() for updates. */
  readonly progress: <A, E, R>(
    opts: ProgressOptions,
    effect: Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E, R>
  /** Update the active spinner or progress bar message in-place. No-op if none active. */
  readonly message: (message: string) => Effect.Effect<void>
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
 * progress bar). Methods that update in-place (d.message) target whichever element is active.
 */
type ActiveInteractive =
  | { readonly type: "spinner"; readonly handle: ReturnType<typeof clack.spinner> }
  | { readonly type: "progress"; readonly handle: ReturnType<typeof clack.progress> }
  | null

let activeInteractive: ActiveInteractive = null

/** Display implementation using @clack/prompts for interactive terminal output */
export const ClackDisplay = {
  layer: Layer.succeed(Display, {
    intro: (title) => Effect.sync(() => clack.intro(styleText("inverse", ` ${title} `))),

    outro: (message) => Effect.sync(() => clack.outro(message)),

    status: (message, severity) =>
      Effect.sync(() => severityToClack[severity](terminalStyle.status(message))),

    note: (content, title) => Effect.sync(() => clack.note(content, title)),

    text: (message) => Effect.sync(() => clack.log.message(message)),

    spinner: <A, E, R>(message: string, effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
      Effect.acquireUseRelease(
        Effect.sync(() => {
          const s = clack.spinner()
          s.start(message)
          activeInteractive = { type: "spinner", handle: s }
          return s
        }),
        () => effect,
        (s, exit) =>
          Effect.sync(() => {
            activeInteractive = null
            if (exit._tag === "Success") {
              s.stop(message)
            } else {
              s.stop(`${message} (failed)`)
            }
          }),
      ),

    progress: <A, E, R>(
      opts: ProgressOptions,
      effect: Effect.Effect<A, E, R>,
    ): Effect.Effect<A, E, R> =>
      Effect.acquireUseRelease(
        Effect.sync(() => {
          const bar = clack.progress({
            max: opts.max,
            style: opts.style ?? "heavy",
            size: opts.size ?? 40,
            indicator: opts.indicator ?? "dots",
          })
          bar.start(opts.message)
          activeInteractive = { type: "progress", handle: bar }
          return bar
        }),
        () => effect,
        (bar, exit) =>
          Effect.sync(() => {
            activeInteractive = null
            if (exit._tag === "Success") {
              bar.stop(opts.message)
            } else {
              bar.error(opts.message)
            }
          }),
      ),

    message: (msg) =>
      Effect.sync(() => {
        if (activeInteractive?.type === "spinner") {
          activeInteractive.handle.message(msg)
        } else if (activeInteractive?.type === "progress") {
          activeInteractive.handle.message(msg)
        }
      }),

    json: () => Effect.void,
  }),
}

/** Display implementation for --json mode — no-ops interactive methods, writes JSON to stdout */
export const JsonDisplay = {
  layer: Layer.succeed(Display, {
    intro: () => Effect.void,
    outro: () => Effect.void,
    status: () => Effect.void,
    note: () => Effect.void,
    text: () => Effect.void,
    spinner: <A, E, R>(_message: string, effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
      effect,
    progress: <A, E, R>(
      _opts: ProgressOptions,
      effect: Effect.Effect<A, E, R>,
    ): Effect.Effect<A, E, R> => effect,
    message: () => Effect.void,
    json: (data) => Effect.sync(() => process.stdout.write(`${JSON.stringify(data)}\n`)),
  }),
}

/**
 * Display implementation that records all calls to a Ref for test assertions. Spinner and progress
 * pass through the wrapped effect result unchanged.
 */
export const SilentDisplay = {
  layer: (ref: Ref.Ref<ReadonlyArray<DisplayEntry>>): Layer.Layer<Display> =>
    Layer.succeed(Display, {
      intro: (title) =>
        Ref.update(ref, (entries) => [...entries, { _tag: "intro" as const, title }]),

      outro: (message) =>
        Ref.update(ref, (entries) => [...entries, { _tag: "outro" as const, message }]),

      status: (message, severity) =>
        Ref.update(ref, (entries) => [...entries, { _tag: "status" as const, message, severity }]),

      note: (content, title) =>
        Ref.update(ref, (entries) => [...entries, { _tag: "note" as const, content, title }]),

      text: (message) =>
        Ref.update(ref, (entries) => [...entries, { _tag: "text" as const, message }]),

      spinner: <A, E, R>(message: string, effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
        effect.pipe(
          Effect.tap(() =>
            Ref.update(ref, (entries) => [...entries, { _tag: "spinner" as const, message }]),
          ),
        ),

      progress: <A, E, R>(
        opts: ProgressOptions,
        effect: Effect.Effect<A, E, R>,
      ): Effect.Effect<A, E, R> =>
        effect.pipe(
          Effect.tap(() =>
            Ref.update(ref, (entries) => [
              ...entries,
              { _tag: "progress" as const, message: opts.message, max: opts.max },
            ]),
          ),
        ),

      message: (msg) =>
        Ref.update(ref, (entries) => [...entries, { _tag: "message" as const, message: msg }]),

      json: (data) => Ref.update(ref, (entries) => [...entries, { _tag: "json" as const, data }]),
    }),
}
