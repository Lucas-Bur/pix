import { Command, Options } from "@effect/cli"
import { Console, Effect } from "effect"

import { GetStatus } from "../application/get-status.js"
import { reportError } from "../lib/error-format.js"
import { formatBytes } from "../lib/format.js"

/** CLI command: pix status [--json] */
export const statusCommand = Command.make(
  "status",
  {
    json: Options.boolean("json").pipe(Options.withDefault(false)),
  },
  ({ json }) =>
    Effect.gen(function* () {
      const result = yield* GetStatus.getStatus()

      if (json) {
        return yield* Console.log(JSON.stringify(result, null, 2))
      }

      const lastIndexStr = result.lastIndex > 0 ? new Date(result.lastIndex).toISOString() : "never"

      yield* Effect.logInfo(`Indexed: ${result.chunks} chunks across ${result.files} files`)
      yield* Effect.logInfo(`Model: ${result.model || "none"}`)
      yield* Effect.logInfo(`Total lines: ${result.totalLines.toLocaleString()}`)
      yield* Effect.logInfo(`Index size: ${formatBytes(result.byteSize)}`)
      yield* Effect.logInfo(`Last indexed: ${lastIndexStr}`)
    }).pipe(
      Effect.catchTags({
        StoreError: reportError,
      }),
    ),
)
