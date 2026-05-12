import { createRequire } from "node:module"

import { CliConfig, Command } from "@effect/cli"
import { Effect } from "effect"

import { indexCommand } from "./commands/index-cmd.ts"
import { initCommand } from "./commands/init.ts"
import { queryCommand } from "./commands/query.ts"
import { resetCommand } from "./commands/reset.ts"
import { statusCommand } from "./commands/status.ts"

const require = createRequire(import.meta.url)
const VERSION = (require("../package.json") as { version: string }).version

const rootCommand = Command.make("pix", {}, () =>
  Effect.gen(function* () {
    yield* Effect.logInfo("pix - Lightweight local semantic project indexer")
    yield* Effect.logInfo("Use `pix --help` to see available commands.")
  }),
)

const pix = rootCommand.pipe(
  Command.withSubcommands([initCommand, statusCommand, indexCommand, queryCommand, resetCommand]),
)

export const cli = (args: readonly string[]) =>
  Command.run(pix, { name: "pix", version: VERSION })(args).pipe(
    Effect.provide(CliConfig.layer({ showTypes: false })),
  )
