import { Effect } from "effect"
import { CliError, Command } from "effect/unstable/cli"

import { ClearEmbeddingCache } from "../application/clear-embedding-cache.js"
import { Display } from "../domain/ports.js"
import { reportError } from "../lib/errors/error-format.js"

/** CLI command: pix cache clear [--json]. */
export const clearCacheCommand = Command.make("clear", {}, () =>
  Effect.gen(function* () {
    const d = yield* Display
    const removed = yield* (yield* ClearEmbeddingCache).clear
    yield* d.json({ status: "ok", removed })
    yield* d.log(removed ? "Embedding cache cleared." : "Embedding cache already empty.", "info")
  }).pipe(Effect.catch(reportError)),
).pipe(
  Command.withDescription("Delete historical Dense and Sparse embeddings from the local index"),
  Command.withShortDescription("Delete cached embeddings"),
)

/**
 * Build the cache namespace. Subcommands are supplied by the caller so cli.ts can provide layers to
 * the leaves while the unit tests pass raw leaves (whose services come from testLayer).
 */
export const makeCacheCommand = <const Subcommands extends readonly any[]>(
  subcommands: Subcommands,
) =>
  Command.make(
    "cache",
    {},
    () => new CliError.ShowHelp({ commandPath: ["pix", "cache"], errors: [] }),
  ).pipe(
    Command.withSubcommands(subcommands),
    Command.withDescription("Inspect and clear local embedding caches"),
    Command.withShortDescription("Manage the embedding cache"),
  )

/** Cache namespace with raw leaves, used by unit tests. */
export const cacheCommand = makeCacheCommand([clearCacheCommand])
