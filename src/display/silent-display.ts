import { Effect, Layer, Ref } from "effect"

import { Display, type DisplayProgressOptions as ProgressOptions } from "../domain/ports.js"
import { DisplayEntry } from "./entries.js"
import type { DisplayEntry as DisplayEntryType } from "./entries.js"

export const SilentDisplayLive = (
  ref: Ref.Ref<ReadonlyArray<DisplayEntryType>>,
): Layer.Layer<Display> =>
  Layer.succeed(Display, {
    intro: (title) => Ref.update(ref, (entries) => [...entries, DisplayEntry.intro({ title })]),

    outro: (message) => Ref.update(ref, (entries) => [...entries, DisplayEntry.outro({ message })]),

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
  })
