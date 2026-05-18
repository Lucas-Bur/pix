import { Command, Options } from "@effect/cli"
import { Clock, Effect } from "effect"

import { ResetIndex } from "../application/reset-index.js"
import { Display } from "../domain/ports.js"
import { reportError } from "../lib/errors/error-format.js"
import { formatBytes } from "../lib/formatting/format.js"

/** CLI command: pix reset [--json] */
export const resetCommand = Command.make(
  "reset",
  {
    json: Options.boolean("json").pipe(Options.withDefault(false)),
  },
  () =>
    Effect.gen(function* () {
      const d = yield* Display
      const start = yield* Clock.currentTimeMillis
      const result = yield* d.spinner("Resetting index...", ResetIndex.reset())
      const end = yield* Clock.currentTimeMillis
      const elapsedMs = end - start

      yield* d.json({
        status: "ok",
        deletedChunks: result.deletedChunks,
        deletedVectors: result.deletedVectors,
        freedBytes: result.freedBytes,
        elapsedMs,
      })

      const deletedParts = [
        result.deletedChunks ? "chunks.jsonl" : null,
        result.deletedVectors ? "vectors.bin" : null,
      ].filter((part): part is string => part !== null)

      if (deletedParts.length === 0) {
        yield* d.log("Nothing to reset.", "info")
      } else {
        yield* d.log(`Deleted: ${deletedParts.join(", ")}`, "success")
        yield* d.log(`Freed: ${formatBytes(result.freedBytes)}`, "info")
        yield* d.log(`Time: ${elapsedMs}ms`, "info")
      }
    }).pipe(
      Effect.catchTags({
        DiskFullError: reportError,
        StoreError: reportError,
      }),
    ),
)
