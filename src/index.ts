import { NodeRuntime, NodeContext } from "@effect/platform-node"
import { Effect, Layer } from "effect"

import { GetStatus } from "./application/get-status.js"
import { IndexProject } from "./application/index-project.js"
import { InitProject } from "./application/init-project.js"
import { cli } from "./cli.js"
import { ChunkerLive } from "./services/chunker.js"
import { ConfigStoreLive } from "./services/config-store.js"
import { OnnxEmbedderLive } from "./services/embedder.js"
import { ScannerLive } from "./services/scanner.js"
import { VectorStoreLive } from "./services/vector-store.js"

const VERSION = "0.1.0"

// Each command layer wires its own dependencies
const initLayer = InitProject.Default.pipe(
  Layer.provideMerge(ConfigStoreLive),
  Layer.provideMerge(NodeContext.layer),
)

const statusLayer = GetStatus.Default.pipe(
  Layer.provideMerge(VectorStoreLive),
  Layer.provideMerge(NodeContext.layer),
)

const indexLayer = IndexProject.Default.pipe(
  Layer.provideMerge(ConfigStoreLive),
  Layer.provideMerge(ScannerLive),
  Layer.provideMerge(ChunkerLive),
  Layer.provideMerge(OnnxEmbedderLive),
  Layer.provideMerge(VectorStoreLive),
  Layer.provideMerge(NodeContext.layer),
)

// Provide NodeContext to each command layer before merging
const initLayerWithContext = initLayer.pipe(Layer.provideMerge(NodeContext.layer))
const statusLayerWithContext = statusLayer.pipe(Layer.provideMerge(NodeContext.layer))
const indexLayerWithContext = indexLayer.pipe(Layer.provideMerge(NodeContext.layer))

// Merge with NodeContext last
const serviceLayer = Layer.mergeAll(
  ConfigStoreLive,
  ScannerLive,
  ChunkerLive,
  OnnxEmbedderLive,
  VectorStoreLive,
  initLayerWithContext,
  statusLayerWithContext,
  indexLayerWithContext,
  NodeContext.layer,
)

// @ts-expect-error Layer composition types are complex but runtime wiring is correct
cli(process.argv, VERSION).pipe(Effect.provide(serviceLayer), NodeRuntime.runMain)
