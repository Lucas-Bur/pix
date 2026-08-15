import { NodeRuntime, NodeServices } from "@effect/platform-node"
import { Effect } from "effect"
import { CliConfig } from "effect/unstable/cli"

import { PixCliConfig } from "./cli-config.js"
import { cli } from "./cli.js"
import { setupTerminalCleanup } from "./display/terminalCleanup.js"

setupTerminalCleanup()

const main = cli.pipe(
  Effect.provideService(CliConfig.CliConfig, PixCliConfig),
  Effect.provide(NodeServices.layer),
)

NodeRuntime.runMain(main)
