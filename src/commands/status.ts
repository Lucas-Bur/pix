import { Command, Options } from "@effect/cli"
import { Effect } from "effect"

import { GetStatus } from "../application/get-status.js"
import { Display } from "../display/Display.js"
import { reportError } from "../lib/error-format.js"

/** CLI command: pix status [--json] */
export const statusCommand = Command.make(
  "status",
  {
    json: Options.boolean("json").pipe(Options.withDefault(false)),
  },
  () =>
    Effect.gen(function* () {
      const d = yield* Display
      const result = yield* GetStatus.getStatus()

      yield* d.json(result)

      const lastIndexStr =
        result.lastIndex > 0 ? new Date(result.lastIndex).toLocaleString() : "never"
      yield* d.status(`Indexed: ${result.chunks} chunks across ${result.files} files`, "info")
      yield* d.status(`Model: ${result.model || "none"}`, "info")
      yield* d.status(`Total lines: ${result.totalLines.toLocaleString()}`, "info")
      yield* d.status(`Index size: ${result.byteSize.toLocaleString()} bytes`, "info")
      yield* d.status(`Last indexed: ${lastIndexStr}`, "info")
    }).pipe(
      Effect.catchTags({
        StoreError: reportError,
      }),
    ),
)
