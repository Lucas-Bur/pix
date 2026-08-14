import { Effect } from "effect"
import { Command } from "effect/unstable/cli"

import { ClearEmbeddingCache } from "../application/clear-embedding-cache.js"
import { Display } from "../domain/ports.js"
import { reportError } from "../lib/errors/error-format.js"

/** CLI command: pix cache clear [--json]. */
const clearCacheCommand = Command.make("clear", {}, () =>
  Effect.gen(function* () {
    const d = yield* Display
    const removed = yield* (yield* ClearEmbeddingCache).clear
    yield* d.json({ status: "ok", removed })
    yield* d.log(removed ? "Embedding cache cleared." : "Embedding cache already empty.", "info")
  }).pipe(Effect.catch(reportError)),
)

/** CLI namespace for cache maintenance. */
export const cacheCommand = Command.make("cache", {}, () =>
  Effect.gen(function* () {
    const d = yield* Display
    yield* d.log("Usage: pix cache <command>", "info")
  }),
).pipe(Command.withSubcommands([clearCacheCommand]))
