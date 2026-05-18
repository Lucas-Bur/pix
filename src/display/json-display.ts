import { FileSystem } from "@effect/platform"
import { Effect, Layer } from "effect"

import {
  Display,
  type DisplayService,
  type DisplayProgressOptions as ProgressOptions,
} from "../domain/ports.js"
import { appendLogEntry, makeJsonHandler, updatePayloadLog, withLoggedEffect } from "./logging.js"

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
