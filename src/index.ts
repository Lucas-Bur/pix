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
import { ChunkerLive } from "./services/chunker.js"
import { ConfigStoreLive } from "./services/config-store.js"
import { ContentExtractorLive } from "./services/content-extractor.js"
import { OnnxEmbedderLive } from "./services/embedder.js"
import { IndexStoreLive } from "./services/index-store.js"
import { ScannerLive } from "./services/scanner.js"

// === Layer 1: Infrastructure services ===
const ServicesLayer = Layer.mergeAll(
  ConfigStoreLive,
  ScannerLive,
  OnnxEmbedderLive,
  IndexStoreLive,
  ContentExtractorLive,
)

// === Layer 2: Services that depend on other services ===
const ChunkerLayer = ChunkerLive.pipe(Layer.provide(ServicesLayer))

// === Layer 3: Full infrastructure layer ===
const InfraLayer = Layer.mergeAll(ServicesLayer, ChunkerLayer).pipe(
  Layer.provide(NodeContext.layer),
)

// === Layer 4: Application use cases ===
const UseCaseLayer = Layer.mergeAll(
  InitProject.Default,
  GetStatus.Default,
  QueryProject.Default,
  IndexProject.Default,
  ResetIndex.Default,
  BenchProject.Default,
)

// === AppLayer: wiring everything together ===
const AppLayer = Layer.merge(UseCaseLayer.pipe(Layer.provide(InfraLayer)), NodeContext.layer)

const { effect, displayLayer } = cli(process.argv)

const cliLayer = Layer.mergeAll(
  displayLayer.pipe(Layer.provide(NodeContext.layer)),
  CliConfig.layer({ showTypes: false }),
)

setupTerminalCleanup()

effect.pipe(
  Effect.provide(AppLayer.pipe(Layer.provideMerge(cliLayer))),
  NodeRuntime.runMain({ disableErrorReporting: true }),
)
