import { Effect, Layer } from "effect"

import { Display } from "../display/Display.js"
import { Logger } from "../domain/ports.js"

export const LoggerLive: Layer.Layer<Logger, never, Display> = Layer.effect(
  Logger,
  Effect.gen(function* () {
    const d = yield* Display
    return {
      warn: (message: string) => d.log(message, "warn"),
    }
  }),
)
