import { createRequire } from "node:module"

import { Command } from "@effect/cli"
import { Effect } from "effect"

import { indexCommand } from "./commands/index-cmd.ts"
import { initCommand } from "./commands/init.ts"
import { queryCommand } from "./commands/query.ts"
import { resetCommand } from "./commands/reset.ts"
import { statusCommand } from "./commands/status.ts"
import { ClackDisplay, Display, JsonDisplay } from "./display/Display.js"

const require = createRequire(import.meta.url)
const VERSION = (require("../package.json") as { version: string }).version

const rootCommand = Command.make("pix", {}, () =>
  Effect.gen(function* () {
    const d = yield* Display
    yield* d.status(`pix v${VERSION} - Lightweight local semantic project indexer`, "info")
  }),
)

const pix = rootCommand.pipe(
  Command.withSubcommands([initCommand, statusCommand, indexCommand, queryCommand, resetCommand]),
)

export const cli = (args: readonly string[]) => {
  const isJson = args.some((a) => a === "--json")
  const displayLayer = isJson ? JsonDisplay.layer : ClackDisplay.layer

  const effect = Command.run(pix, { name: "pix", version: VERSION })(args)

  return { effect, displayLayer }
}
