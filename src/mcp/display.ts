import { Effect, Layer } from "effect"

import { InteractiveError } from "../domain/errors.js"
import { Display, type DisplayProgressOptions, type DisplayService } from "../domain/ports.js"

/** Display adapter that keeps MCP stdout reserved for protocol traffic. */
export const McpDisplayLive = Layer.succeed(Display, {
  intro: () => Effect.void,
  outro: () => Effect.void,
  log: () => Effect.void,
  note: () => Effect.void,
  text: () => Effect.void,
  table: () => Effect.void,
  spinner: <A, E, R>(_message: string, effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
    effect,
  progress: <A, E, R>(
    _options: DisplayProgressOptions,
    effect: Effect.Effect<A, E, R>,
  ): Effect.Effect<A, E, R> => effect,
  updateInteractive: () => Effect.void,
  select: (_message, _options, defaultValue) =>
    defaultValue === undefined
      ? Effect.fail(new InteractiveError({ message: "MCP cannot answer interactive prompts" }))
      : Effect.succeed(defaultValue),
  json: () => Effect.void,
} satisfies DisplayService)
