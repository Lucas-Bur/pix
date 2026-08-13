import { Effect } from "effect"
import { Command } from "effect/unstable/cli"

import { aliasCommand, runAliasShortcutCommand } from "./commands/alias.js"
import { benchCommand } from "./commands/bench.js"
import { cacheCommand } from "./commands/cache.js"
import { configCommand } from "./commands/config.js"
import { indexCommand } from "./commands/index-cmd.js"
import { initCommand } from "./commands/init.js"
import { mcpCommand } from "./commands/mcp.js"
import { queryCommand } from "./commands/query.js"
import { resetCommand } from "./commands/reset.js"
import { statusCommand } from "./commands/status.js"
import { ClackDisplayLive } from "./display/clack-display.js"
import { JsonDisplayLive } from "./display/json-display.js"
import { Display } from "./domain/ports.js"
import { loadLayer } from "./layers/load-layer.js"
import { VERSION } from "./version.js"

const rootCommand = Command.make("pix", {}, () =>
  Effect.gen(function* () {
    const d = yield* Display
    yield* d.log(`pix v${VERSION} - Lightweight local semantic project indexer`, "info")
  }),
)

const pix = rootCommand.pipe(
  Command.withSubcommands([
    initCommand.pipe(
      Command.provide(loadLayer(() => import("./layers/init-layer.js").then((m) => m.InitLayer))),
    ),
    statusCommand.pipe(
      Command.provide(
        loadLayer(() => import("./layers/status-layer.js").then((m) => m.StatusLayer)),
      ),
    ),
    indexCommand.pipe(
      Command.provide(loadLayer(() => import("./layers/index-layer.js").then((m) => m.IndexLayer))),
    ),
    queryCommand.pipe(
      Command.provide(loadLayer(() => import("./layers/query-layer.js").then((m) => m.QueryLayer))),
    ),
    resetCommand.pipe(
      Command.provide(loadLayer(() => import("./layers/reset-layer.js").then((m) => m.ResetLayer))),
    ),
    benchCommand.pipe(
      Command.provide(loadLayer(() => import("./layers/bench-layer.js").then((m) => m.BenchLayer))),
    ),
    configCommand.pipe(
      Command.provide(
        loadLayer(() => import("./layers/config-heal-layer.js").then((m) => m.ConfigHealLayer)),
      ),
    ),
    aliasCommand.pipe(
      Command.provide(loadLayer(() => import("./layers/alias-layer.js").then((m) => m.AliasLayer))),
    ),
    runAliasShortcutCommand.pipe(
      Command.provide(loadLayer(() => import("./layers/alias-layer.js").then((m) => m.AliasLayer))),
    ),
    cacheCommand.pipe(
      Command.provide(loadLayer(() => import("./layers/cache-layer.js").then((m) => m.CacheLayer))),
    ),
    mcpCommand,
  ]),
)

export const cli = (args: readonly string[]) => {
  const isJson = args.some((a) => a === "--json")
  const displayLayer = isJson ? JsonDisplayLive : ClackDisplayLive

  const effect = Command.run(pix, { version: VERSION })

  return { effect, displayLayer }
}
