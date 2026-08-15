import { Effect, Layer } from "effect"
import { Flag, GlobalFlag } from "effect/unstable/cli"

import { ClackDisplayLive } from "./display/clack-display.js"
import { JsonDisplayLive } from "./display/json-display.js"

/** Global CLI setting for selecting machine-readable JSON output. */
export const JsonOutput = GlobalFlag.setting("json-output")({
  flag: Flag.boolean("json").pipe(
    Flag.withAlias("j"),
    Flag.withDescription("Emit machine-readable JSON output"),
  ),
})

/** Display adapter selected from the parsed global output setting. */
export const CliDisplayLive = Layer.unwrap(
  Effect.gen(function* () {
    return (yield* JsonOutput) ? JsonDisplayLive : ClackDisplayLive
  }),
)
