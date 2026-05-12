import { Command, Options } from "@effect/cli"
import { Clock, Console, Effect } from "effect"

import { ResetIndex } from "../application/reset-index.js"
import { formatError } from "../lib/error-format.js"
import { formatBytes } from "../lib/format.js"

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
        return yield* Console.log(
          JSON.stringify({
            status: "ok",
            deletedChunks: result.deletedChunks,
            deletedVectors: result.deletedVectors,
            freedBytes: result.freedBytes,
            elapsedMs,
          }),
        )
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
    }).pipe(Effect.tapError((error) => Console.log(formatError(error)))),
)
