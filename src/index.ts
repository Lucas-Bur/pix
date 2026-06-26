import { NodeRuntime, NodeServices } from "@effect/platform-node"
import { Effect, Layer } from "effect"

import { BenchProjectLive } from "./application/bench-project.js"
import { GetStatusLive } from "./application/get-status.js"
import { IndexProjectLive } from "./application/index-project.js"
import { InitProjectLive } from "./application/init-project.js"
import { QueryProjectLive } from "./application/query-project.js"
import { ResetIndexLive } from "./application/reset-index.js"
import { cli } from "./cli.js"
import { setupTerminalCleanup } from "./display/terminalCleanup.js"
import { ConfigLayer } from "./layers/config-layer.js"
import { EmbedderLayer } from "./layers/embedder-layer.js"
import { FullInfraLayer } from "./layers/full-infra-layer.js"
import { IndexStoreLayer } from "./layers/index-store-layer.js"

// Infrastructure: services provided via Layer.suspend for lazy construction
const InfraLayer = Layer.suspend(() =>
  Layer.mergeAll(ConfigLayer, IndexStoreLayer, EmbedderLayer, FullInfraLayer).pipe(
    Layer.provide(NodeServices.layer),
  ),
)

// Application use cases
const UseCaseLayer = Layer.mergeAll(
  InitProjectLive,
  GetStatusLive,
  QueryProjectLive,
  IndexProjectLive,
  ResetIndexLive,
  BenchProjectLive,
)

const AppLayer = Layer.merge(UseCaseLayer.pipe(Layer.provideMerge(InfraLayer)), NodeServices.layer)

const { effect, displayLayer } = cli(process.argv)

const cliLayer = Layer.mergeAll(displayLayer.pipe(Layer.provide(NodeServices.layer)))

setupTerminalCleanup()

effect.pipe(
  Effect.provide(AppLayer.pipe(Layer.provideMerge(cliLayer))),
  NodeRuntime.runMain({ disableErrorReporting: false }),
)
