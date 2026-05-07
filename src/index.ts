import { NodeRuntime, NodeContext } from "@effect/platform-node"
import { Effect, Layer } from "effect"

import { GetStatus } from "./application/get-status.js"
import { IndexProject } from "./application/index-project.js"
import { InitProject } from "./application/init-project.js"
import { QueryProject } from "./application/query-project.js"
import { cli } from "./cli.js"
import { ChunkerLive } from "./services/chunker.js"
import { ConfigStoreLive } from "./services/config-store.js"
import { OnnxEmbedderLive } from "./services/embedder.js"
import { ScannerLive } from "./services/scanner.js"
import { VectorStoreLive } from "./services/vector-store.js"

// === 1. Adapter Layers mit NodeContext.layer für FileSystem ===

const configStoreLayer = ConfigStoreLive.pipe(Layer.provide(NodeContext.layer))
const scannerLayer = ScannerLive.pipe(Layer.provide(NodeContext.layer))
const embedderLayer = OnnxEmbedderLive.pipe(Layer.provide(NodeContext.layer))
const vectorStoreLayer = VectorStoreLive.pipe(Layer.provide(NodeContext.layer))

// Chunker braucht ConfigStore UND FileSystem
// Erst NodeContext bereitstellen, dann ConfigStore mergen
const chunkerLayer = Layer.provideMerge(
  ChunkerLive.pipe(Layer.provide(NodeContext.layer)),
  configStoreLayer,
)

// === 2. Zentrales AppLayer mit Layer.provideMerge (nacheinander, nicht parallel) ===
// Layer.provideMerge ist wie mergeAll aber mit klarer Reihenfolge

const AppLayer = Layer.provideMerge(
  Layer.provideMerge(
    Layer.provideMerge(
      Layer.provideMerge(
        Layer.provideMerge(
          Layer.provideMerge(
            Layer.provideMerge(
              Layer.provideMerge(InitProject.Default, GetStatus.Default),
              Layer.provideMerge(QueryProject.Default, IndexProject.Default),
            ),
            configStoreLayer,
          ),
          scannerLayer,
        ),
        chunkerLayer,
      ),
      embedderLayer,
    ),
    vectorStoreLayer,
  ),
  NodeContext.layer,
)

cli(process.argv).pipe(Effect.provide(AppLayer), NodeRuntime.runMain)
