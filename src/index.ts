import { NodeRuntime, NodeServices } from "@effect/platform-node"
import { Effect, Layer } from "effect"

import { cli } from "./cli.js"
import { setupTerminalCleanup } from "./display/terminalCleanup.js"

const { effect, displayLayer } = cli(process.argv)
const cliLayer = displayLayer.pipe(Layer.provide(NodeServices.layer))
setupTerminalCleanup()

const main = effect.pipe(Effect.provide(Layer.mergeAll(cliLayer, NodeServices.layer)))

NodeRuntime.runMain(main)
