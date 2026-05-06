import { NodeRuntime, NodeContext } from "@effect/platform-node"
import { Effect, Layer } from "effect"

import { InitProject } from "./application/init-project.js"
import { cli } from "./cli.js"
import { ConfigStoreLive } from "./services/config-store.js"
import { ScannerLive } from "./services/scanner.js"

const VERSION = "0.1.0"

const initProjectLayer = InitProject.Default.pipe(Layer.provideMerge(ConfigStoreLive))

const serviceLayer = Layer.mergeAll(initProjectLayer, ScannerLive).pipe(
  Layer.provideMerge(NodeContext.layer),
)

cli(process.argv, VERSION).pipe(Effect.provide(serviceLayer), NodeRuntime.runMain)
