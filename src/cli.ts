import { CliError, Command } from "effect/unstable/cli"

import { CliDisplayLive, JsonOutput } from "./cli-output.js"
import {
  aliasAddCommand,
  aliasListCommand,
  aliasRemoveCommand,
  makeAliasCommand,
  runAliasShortcutCommand,
} from "./commands/alias.js"
import { benchCommand } from "./commands/bench.js"
import { clearCacheCommand, makeCacheCommand } from "./commands/cache.js"
import { healCommand, makeConfigCommand } from "./commands/config.js"
import { indexCommand } from "./commands/index-cmd.js"
import { initCommand } from "./commands/init.js"
import { mcpCommand } from "./commands/mcp.js"
import { queryCommand } from "./commands/query.js"
import { resetCommand } from "./commands/reset.js"
import { statusCommand } from "./commands/status.js"
import { loadLayer } from "./layers/load-layer.js"
import { VERSION } from "./version.js"

const aliasLayer = loadLayer(() => import("./layers/alias-layer.js").then((m) => m.AliasLayer))
const configHealLayer = loadLayer(() =>
  import("./layers/config-heal-layer.js").then((m) => m.ConfigHealLayer),
)
const cacheLayer = loadLayer(() => import("./layers/cache-layer.js").then((m) => m.CacheLayer))

const rootCommand = Command.make(
  "pix",
  {},
  () => new CliError.ShowHelp({ commandPath: ["pix"], errors: [] }),
).pipe(Command.withDescription("Local semantic code search for humans and AI agents"))

/** Root pix command tree. */
export const pixCommand = rootCommand.pipe(
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
    makeConfigCommand([healCommand.pipe(Command.provide(configHealLayer))]),
    makeAliasCommand([
      aliasAddCommand.pipe(Command.provide(aliasLayer)),
      aliasListCommand.pipe(Command.provide(aliasLayer)),
      aliasRemoveCommand.pipe(Command.provide(aliasLayer)),
    ]),
    runAliasShortcutCommand.pipe(Command.provide(aliasLayer)),
    makeCacheCommand([clearCacheCommand.pipe(Command.provide(cacheLayer))]),
    mcpCommand,
  ]),
  Command.provide(CliDisplayLive),
  Command.withGlobalFlags([JsonOutput]),
)

/** Runnable pix CLI using arguments from the platform Stdio service. */
export const cli = Command.run(pixCommand, { version: VERSION })
