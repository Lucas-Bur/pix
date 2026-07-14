import { createRequire } from "node:module"

import { Effect } from "effect"
import { Command } from "effect/unstable/cli"

import { aliasCommand, runAliasShortcutCommand } from "./commands/alias.js"
import { benchCommand } from "./commands/bench.js"
import { cacheCommand } from "./commands/cache.js"
import { configCommand } from "./commands/config.js"
import { indexCommand } from "./commands/index-cmd.js"
import { initCommand } from "./commands/init.js"
import { queryCommand } from "./commands/query.js"
import { resetCommand } from "./commands/reset.js"
import { statusCommand } from "./commands/status.js"
import { ClackDisplayLive } from "./display/clack-display.js"
import { JsonDisplayLive } from "./display/json-display.js"
import { Display } from "./domain/ports.js"

const require = createRequire(import.meta.url)
const VERSION = (require("../package.json") as { version: string }).version

const rootCommand = Command.make("pix", {}, () =>
  Effect.gen(function* () {
    const d = yield* Display
    yield* d.log(`pix v${VERSION} - Lightweight local semantic project indexer`, "info")
  }),
)

const pix = rootCommand.pipe(
  Command.withSubcommands([
    initCommand,
    statusCommand,
    indexCommand,
    queryCommand,
    resetCommand,
    benchCommand,
    configCommand,
    aliasCommand,
    runAliasShortcutCommand,
    cacheCommand,
  ]),
)

export const cli = (args: readonly string[]) => {
  const isJson = args.some((a) => a === "--json")
  const displayLayer = isJson ? JsonDisplayLive : ClackDisplayLive

  const effect = Command.run(pix, { version: VERSION })

  return { effect, displayLayer }
}
