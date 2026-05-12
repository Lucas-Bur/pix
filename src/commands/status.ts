import { Command, Options } from "@effect/cli"
import { Effect } from "effect"

import { GetStatus } from "../application/get-status.js"

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
        return yield* Effect.sync(() => {
          console.log(JSON.stringify(result, null, 2))
        })
      }

      // Format lastIndex as ISO date for human-readable output
      const lastIndexStr = result.lastIndex > 0 ? new Date(result.lastIndex).toISOString() : "never"

      yield* Effect.logInfo(`Indexed: ${result.chunks} chunks across ${result.files} files`)
      yield* Effect.logInfo(`Model: ${result.model || "none"}`)
      yield* Effect.logInfo(`Total lines: ${result.totalLines.toLocaleString()}`)
      yield* Effect.logInfo(`Index size: ${formatBytes(result.byteSize)}`)
      yield* Effect.logInfo(`Last indexed: ${lastIndexStr}`)
    }),
)

/** Format byte count as human-readable string (e.g. "1.5 MB") */
const formatBytes = (bytes: number): string => {
  if (bytes === 0) return "0 B"
  const units = ["B", "KB", "MB", "GB"]
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`
}
