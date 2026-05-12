import { CliConfig } from "@effect/cli"
import { Effect, Layer } from "effect"
import { MemoryFileSystem } from "effect-memfs"

import { GetStatus } from "../../src/application/get-status.js"
import { IndexProject } from "../../src/application/index-project.js"
import { InitProject } from "../../src/application/init-project.js"
import { QueryProject } from "../../src/application/query-project.js"
import { ResetIndex } from "../../src/application/reset-index.js"
import { Embedder, Scanner } from "../../src/domain/ports.js"
import { ChunkerLive } from "../../src/services/chunker.js"
import { ConfigStoreLive } from "../../src/services/config-store.js"
import { VectorStoreLive } from "../../src/services/vector-store.js"
import { layer as MockConsoleLayer } from "./MockConsole.js"

export interface TestLayerOptions {
  readonly contents?: MemoryFileSystem.Contents
  readonly scannerLayer?: Layer.Layer<Scanner>
  readonly embedderLayer?: Layer.Layer<Embedder>
}

const defaultScannerLayer = Layer.succeed(Scanner, {
  scanFiles: () => Effect.succeed<string[]>([]),
})

const defaultEmbedderLayer = Layer.succeed(Embedder, {
  embed: () => Effect.succeed({ vector: new Float32Array(384), dims: 384 }),
  batch: (texts: readonly string[]) =>
    Effect.succeed(texts.map(() => ({ vector: new Float32Array(384), dims: 384 }))),
})

/**
 * Builds the full application layer for integration testing. Replaces real FileSystem with
 * in-memory variant and mocks Scanner + Embedder. Mirrors the layer structure in `src/index.ts`.
 */
export const testLayer = (opts: TestLayerOptions = {}) => {
  const { contents = {}, scannerLayer, embedderLayer } = opts

  const memFs = MemoryFileSystem.layerWith(contents)

  const servicesLayer = Layer.mergeAll(
    ConfigStoreLive,
    scannerLayer ?? defaultScannerLayer,
    embedderLayer ?? defaultEmbedderLayer,
    VectorStoreLive,
  )

  const chunkerLayer = ChunkerLive.pipe(Layer.provide(servicesLayer))

  const infraLayer = Layer.mergeAll(servicesLayer, chunkerLayer).pipe(Layer.provide(memFs))

  const useCaseLayer = Layer.mergeAll(
    InitProject.Default,
    GetStatus.Default,
    QueryProject.Default,
    IndexProject.Default,
    ResetIndex.Default,
  )

  const appLayer = Layer.merge(useCaseLayer.pipe(Layer.provide(infraLayer)), memFs)

  return Layer.mergeAll(appLayer, MockConsoleLayer, CliConfig.layer({ showTypes: false }))
}
