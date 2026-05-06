import { NodeRuntime, NodeContext } from "@effect/platform-node"
import { Effect, Layer } from "effect"

import { GetStatus } from "./application/get-status.js"
import { InitProject } from "./application/init-project.js"
import { cli } from "./cli.js"
import { ConfigStoreLive } from "./services/config-store.js"
import { ScannerLive } from "./services/scanner.js"
import { VectorStoreLive } from "./services/vector-store.js"

const VERSION = "0.1.0"

const initLayer = InitProject.Default.pipe(Layer.provideMerge(ConfigStoreLive))
const statusLayer = GetStatus.Default.pipe(
  Layer.provideMerge(VectorStoreLive),
  Layer.provideMerge(NodeContext.layer),
)

const serviceLayer = Layer.mergeAll(initLayer, statusLayer, ScannerLive).pipe(
  Layer.provideMerge(NodeContext.layer),
)

cli(process.argv, VERSION).pipe(Effect.provide(serviceLayer), NodeRuntime.runMain)
