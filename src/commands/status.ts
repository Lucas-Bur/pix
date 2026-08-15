import { DateTime, Effect } from "effect"
import { Command } from "effect/unstable/cli"

import { GetStatus } from "../application/get-status.js"
import { Display } from "../domain/ports.js"
import { reportError } from "../lib/errors/error-format.js"

/** CLI command: pix status [--json] */
export const statusCommand = Command.make("status", {}, () =>
  Effect.gen(function* () {
    const d = yield* Display
    const svc = yield* GetStatus
    const result = yield* svc.getStatus

    yield* d.json(result)

    const lastIndexStr =
      result.lastIndex > 0 ? DateTime.formatLocal(DateTime.makeUnsafe(result.lastIndex)) : "never"
    yield* d.log(`Indexed: ${result.chunks} chunks across ${result.files} files`, "info")
    yield* d.log(`Model: ${result.model || "none"}`, "info")
    yield* d.log(`Total lines: ${result.totalLines.toLocaleString()}`, "info")
    yield* d.log(`Index size: ${result.byteSize.toLocaleString()} bytes`, "info")
    yield* d.log(`Last indexed: ${lastIndexStr}`, "info")

    if (result.validationErrors.length > 0) {
      yield* d.log(`Warnings: ${result.validationErrors[0].message}`, "warn")
    }
    if (result.diagnostics.length > 0) {
      yield* d.log(`Index diagnostics: ${result.diagnostics.length}`, "warn")
    }
  }).pipe(
    Effect.catchTags({
      StoreError: reportError,
    }),
  ),
).pipe(
  Command.withDescription("Show index size, active model, refresh time, and diagnostics"),
  Command.withShortDescription("Show index, model, and diagnostic status"),
)
