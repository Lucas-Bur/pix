import { NodeRuntime, NodeContext } from "@effect/platform-node"
import { Effect, Layer } from "effect"

import { cli } from "./cli.js"
import { ConfigStoreLive } from "./services/config-store.js"
import { ScannerLive } from "./services/scanner.js"

const VERSION = "0.1.0"

const serviceLayer = Layer.mergeAll(ConfigStoreLive, ScannerLive).pipe(
  Layer.provideMerge(NodeContext.layer),
)

cli(process.argv, VERSION).pipe(Effect.provide(serviceLayer), NodeRuntime.runMain)
