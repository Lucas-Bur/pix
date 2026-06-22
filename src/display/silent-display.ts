import { Effect, Layer, Ref } from "effect"

import { InteractiveError } from "../domain/errors.js"
import { Display, type DisplayProgressOptions as ProgressOptions } from "../domain/ports.js"
import { DisplayEntry } from "./entries.js"
import type { DisplayEntry as DisplayEntryType } from "./entries.js"

export const SilentDisplayLive = (
  ref: Ref.Ref<ReadonlyArray<DisplayEntryType>>,
  selectValue?: string,
): Layer.Layer<Display> =>
  Layer.succeed(Display, {
    intro: (title) => Ref.update(ref, (entries) => [...entries, DisplayEntry.intro({ title })]),

    outro: (message) => Ref.update(ref, (entries) => [...entries, DisplayEntry.outro({ message })]),

    log: (message, severity) =>
      Ref.update(ref, (entries) => [...entries, DisplayEntry.log({ message, severity })]),

    note: (content, title) =>
      Ref.update(ref, (entries) => [...entries, DisplayEntry.note({ content, title })]),

    text: (message) => Ref.update(ref, (entries) => [...entries, DisplayEntry.text({ message })]),

    table: (header, rows) =>
      Ref.update(ref, (entries) => [...entries, DisplayEntry.table({ header, rows })]),

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

    select: <T>(
      message: string,
      options: ReadonlyArray<{ readonly value: T; readonly label: string }>,
      defaultValue?: T,
    ): Effect.Effect<T, InteractiveError> =>
      Effect.gen(function* () {
        yield* Ref.update(ref, (entries) => [
          ...entries,
          DisplayEntry.select({
            message,
            options: options.map((o) => o.label),
            defaultValue: defaultValue as string | undefined,
          }),
        ])
        if (selectValue !== undefined) return selectValue as T
        if (defaultValue !== undefined) return defaultValue
        return yield* new InteractiveError({ message: "No default value for select" })
      }),

    json: (data) => Ref.update(ref, (entries) => [...entries, DisplayEntry.json({ data })]),
  })
