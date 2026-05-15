import { NodeRuntime, NodeContext } from "@effect/platform-node"
import { Effect, Layer } from "effect"

import { GetStatus } from "./application/get-status.js"
import { IndexProject } from "./application/index-project.js"
import { InitProject } from "./application/init-project.js"
import { QueryProject } from "./application/query-project.js"
import { ResetIndex } from "./application/reset-index.js"
import { cli } from "./cli.js"
import { setupTerminalCleanup } from "./display/terminalCleanup.js"
import { ChunkerLive } from "./services/chunker.js"
import { ConfigStoreLive } from "./services/config-store.js"
import { OnnxEmbedderLive } from "./services/embedder.js"
import { ScannerLive } from "./services/scanner.js"
import { VectorStoreLive } from "./services/vector-store.js"

// === Layer 1: Infrastructure services ===
// These services only require NodeContext (FileSystem, Environment, etc.)
// and have no dependencies on each other.
const ServicesLayer = Layer.mergeAll(
  ConfigStoreLive,
  ScannerLive,
  OnnxEmbedderLive,
  VectorStoreLive,
)

// === Layer 2: Services that depend on other services ===
// ChunkerLive requires ConfigStore, so we provide ServicesLayer here.
const ChunkerLayer = ChunkerLive.pipe(Layer.provide(ServicesLayer))

// === Layer 3: Full infrastructure layer ===
// Merges all infra services and satisfies their shared NodeContext dependency
// in one place. NodeContext is provided here so it doesn't leak upward.
const InfraLayer = Layer.mergeAll(ServicesLayer, ChunkerLayer).pipe(
  Layer.provide(NodeContext.layer),
)

// === Layer 4: Application use cases ===
// Pure business logic — each use case depends only on service interfaces (ports),
// not on concrete implementations.
const UseCaseLayer = Layer.mergeAll(
  InitProject.Default,
  GetStatus.Default,
  QueryProject.Default,
  IndexProject.Default,
  ResetIndex.Default,
)

// === AppLayer: wiring everything together ===
// UseCaseLayer receives its dependencies from InfraLayer.
// NodeContext.layer is merged explicitly so that its outputs (FileSystem,
// Environment, etc.) remain visible to the CLI effect at runtime.
// Using Layer.merge instead of Layer.provide ensures the NodeContext outputs
// are part of the AppLayer's output — a single Effect.provide is enough.
const AppLayer = Layer.merge(UseCaseLayer.pipe(Layer.provide(InfraLayer)), NodeContext.layer)

setupTerminalCleanup()

cli(process.argv).pipe(
  Effect.provide(AppLayer),
  NodeRuntime.runMain({ disableErrorReporting: true }),
)
