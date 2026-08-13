import { DateTime, Effect } from "effect"
import { Command, Flag } from "effect/unstable/cli"

import { GetStatus } from "../application/get-status.js"
import { Display } from "../domain/ports.js"
import { reportError } from "../lib/errors/error-format.js"

/** CLI command: pix status [--json] */
export const statusCommand = Command.make(
  "status",
  {
    json: Flag.boolean("json").pipe(Flag.withDefault(false)),
  },
  () =>
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
)
