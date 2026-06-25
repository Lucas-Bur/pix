import { CliConfig } from "@effect/cli"
import { NodeRuntime, NodeContext } from "@effect/platform-node"
import { Effect, Layer } from "effect"

import { BenchProject } from "./application/bench-project.js"
import { GetStatus } from "./application/get-status.js"
import { IndexProject } from "./application/index-project.js"
import { InitProject } from "./application/init-project.js"
import { QueryProject } from "./application/query-project.js"
import { ResetIndex } from "./application/reset-index.js"
import { cli } from "./cli.js"
import { setupTerminalCleanup } from "./display/terminalCleanup.js"
import { ConfigLayer } from "./layers/config-layer.js"
import { EmbedderLayer } from "./layers/embedder-layer.js"
import { FullInfraLayer } from "./layers/full-infra-layer.js"
import { IndexStoreLayer } from "./layers/index-store-layer.js"

// Infrastructure: services provided via Layer.suspend for lazy construction
const InfraLayer = Layer.suspend(() =>
  Layer.mergeAll(ConfigLayer, IndexStoreLayer, EmbedderLayer, FullInfraLayer).pipe(
    Layer.provide(NodeContext.layer),
  ),
)

// Application use cases
const UseCaseLayer = Layer.mergeAll(
  InitProject.Default,
  GetStatus.Default,
  QueryProject.Default,
  IndexProject.Default,
  ResetIndex.Default,
  BenchProject.Default,
)

const AppLayer = Layer.merge(UseCaseLayer.pipe(Layer.provideMerge(InfraLayer)), NodeContext.layer)

const { effect, displayLayer } = cli(process.argv)

const cliLayer = Layer.mergeAll(
  displayLayer.pipe(Layer.provide(NodeContext.layer)),
  CliConfig.layer({ showTypes: false }),
)

setupTerminalCleanup()

effect.pipe(
  Effect.provide(AppLayer.pipe(Layer.provideMerge(cliLayer))),
  NodeRuntime.runMain({ disableErrorReporting: false }),
)
