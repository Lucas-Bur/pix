import { NodeRuntime, NodeServices } from "@effect/platform-node"
import { Effect } from "effect"

import { cli } from "./cli.js"
import { setupTerminalCleanup } from "./display/terminalCleanup.js"

setupTerminalCleanup()

const main = cli.pipe(Effect.provide(NodeServices.layer))

NodeRuntime.runMain(main)
