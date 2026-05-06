import { Command } from "@effect/cli"
import { Effect } from "effect"

import { indexCommand } from "./commands/index-cmd.ts"
import { initCommand } from "./commands/init.ts"
import { statusCommand } from "./commands/status.ts"

const rootCommand = Command.make("pix", {}, () =>
  Effect.gen(function* () {
    yield* Effect.logInfo("pix - Lightweight local semantic project indexer")
    yield* Effect.logInfo("Use `pix --help` to see available commands.")
  }),
)

const pix = rootCommand.pipe(Command.withSubcommands([initCommand, statusCommand, indexCommand]))

export const cli = (argv: string[], version: string) =>
  Command.run(pix, { name: "pix", version })(argv)
