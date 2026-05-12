import { Command, Options } from "@effect/cli"
import { Clock, Effect } from "effect"

import { ResetIndex } from "../application/reset-index.js"

/** CLI command: pix reset [--json] */
export const resetCommand = Command.make(
  "reset",
  {
    json: Options.boolean("json").pipe(Options.withDefault(false)),
  },
  ({ json }) =>
    Effect.gen(function* () {
      const start = yield* Clock.currentTimeMillis
      const result = yield* ResetIndex.reset()
      const end = yield* Clock.currentTimeMillis
      const elapsedMs = end - start

      if (json) {
        return yield* Effect.sync(() => {
          console.log(
            JSON.stringify({
              status: "ok",
              deletedChunks: result.deletedChunks,
              deletedVectors: result.deletedVectors,
              freedBytes: result.freedBytes,
              elapsedMs,
            }),
          )
        })
      }

      if (!result.deletedChunks && !result.deletedVectors) {
        yield* Effect.logInfo("Nothing to reset.")
        return
      }

      const parts: string[] = []
      if (result.deletedChunks) parts.push("chunks.jsonl")
      if (result.deletedVectors) parts.push("vectors.bin")

      yield* Effect.logInfo(`Deleted: ${parts.join(", ")}`)
      yield* Effect.logInfo(`Freed: ${formatBytes(result.freedBytes)}`)
      yield* Effect.logInfo(`Time: ${elapsedMs}ms`)
    }),
)

/** Format byte count as human-readable string (e.g. "1.5 MB") */
const formatBytes = (bytes: number): string => {
  if (bytes === 0) return "0 B"
  const units = ["B", "KB", "MB", "GB"]
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`
}
