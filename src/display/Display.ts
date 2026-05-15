import { styleText } from "node:util"

import * as clack from "@clack/prompts"
import { Context, Effect, Layer, Ref } from "effect"

/** Severity level for status messages */
export type Severity = "info" | "success" | "warn" | "error"

/** Union of all display entries recorded by SilentDisplay for test assertions */
export type DisplayEntry =
  | { readonly _tag: "intro"; readonly title: string }
  | { readonly _tag: "outro"; readonly message: string }
  | { readonly _tag: "status"; readonly message: string; readonly severity: Severity }
  | { readonly _tag: "note"; readonly content: string; readonly title?: string }
  | { readonly _tag: "text"; readonly message: string }
  | { readonly _tag: "spinner"; readonly message: string }
  | { readonly _tag: "progress"; readonly message: string }
  | { readonly _tag: "json"; readonly data: unknown }

/** Display service — abstracts CLI output behind structured methods */
export interface DisplayService {
  readonly intro: (title: string) => Effect.Effect<void>
  readonly outro: (message: string) => Effect.Effect<void>
  readonly status: (message: string, severity: Severity) => Effect.Effect<void>
  readonly note: (content: string, title?: string) => Effect.Effect<void>
  readonly text: (message: string) => Effect.Effect<void>
  readonly spinner: <A, E, R>(
    message: string,
    effect: Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E, R>
  readonly progress: (message: string) => Effect.Effect<void>
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
 * Active spinner handle. Only one spinner runs at a time per the @clack constraint of a single
 * interactive line. `progress` updates this spinner's message in-place.
 */
let activeSpinner: ReturnType<typeof clack.spinner> | null = null

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
          activeSpinner = s
          return s
        }),
        () => effect,
        (s, exit) =>
          Effect.sync(() => {
            activeSpinner = null
            if (exit._tag === "Success") {
              s.stop(message)
            } else {
              s.stop(`${message} (failed)`)
            }
          }),
      ),

    progress: (message) =>
      Effect.sync(() => {
        activeSpinner?.message(message)
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
    progress: () => Effect.void,
    json: (data) => Effect.sync(() => process.stdout.write(`${JSON.stringify(data)}\n`)),
  }),
}

/**
 * Display implementation that records all calls to a Ref for test assertions. Spinner passes
 * through the wrapped effect result unchanged.
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

      progress: (message) =>
        Ref.update(ref, (entries) => [...entries, { _tag: "progress" as const, message }]),

      json: (data) => Ref.update(ref, (entries) => [...entries, { _tag: "json" as const, data }]),
    }),
}
