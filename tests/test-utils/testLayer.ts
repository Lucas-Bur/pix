import type { FileTree } from "@lucas-bur/effect-memfs"
import { Effect, Layer } from "effect"
import { FileSystem } from "effect/FileSystem"

import { BenchProjectLive } from "../../src/application/bench-project.js"
import { ClearEmbeddingCacheLive } from "../../src/application/clear-embedding-cache.js"
import { GetStatusLive } from "../../src/application/get-status.js"
import { IndexProjectLive } from "../../src/application/index-project.js"
import { InitProjectLive } from "../../src/application/init-project.js"
import { QueryProjectLive } from "../../src/application/query-project.js"
import { ResetIndexLive } from "../../src/application/reset-index.js"
import {
  Clipboard,
  ConfigStore,
  DeviceDetection,
  Display,
  Embedder,
  IdentifierExtractor,
  IndexStore,
  QueryAliasStore,
  Scanner,
} from "../../src/domain/ports.js"
import { ChunkerBase } from "../../src/services/chunker.js"
import { ConfigStoreLive } from "../../src/services/config-store.js"
import { ContentExtractorLive } from "../../src/services/content-extractor.js"
import { IdentifierExtractorLive } from "../../src/services/identifier-extractor.js"
import { IndexStoreBase } from "../../src/services/index-store.js"
import { ModelRegistryLive } from "../../src/services/models.js"
import { QueryAliasStoreLive } from "../../src/services/query-alias-store.js"
import { memoryFsLayer } from "./memfs.js"
import { silentDisplay } from "./silentDisplay.js"

export interface TestLayerOptions {
  readonly contents?: FileTree
  readonly scannerLayer?: Layer.Layer<Scanner, never, FileSystem>
  readonly embedderLayer?: Layer.Layer<Embedder, never, FileSystem>
  readonly configStoreLayer?: Layer.Layer<ConfigStore, never, FileSystem>
  readonly indexStoreLayer?: Layer.Layer<IndexStore, never, FileSystem>
  readonly identifierExtractorLayer?: Layer.Layer<IdentifierExtractor, never, FileSystem>
  readonly clipboardLayer?: Layer.Layer<Clipboard>
  readonly queryAliasStoreLayer?: Layer.Layer<QueryAliasStore, never, FileSystem>
  readonly displayLayer?: Layer.Layer<Display>
  readonly deviceDetectionLayer?: Layer.Layer<DeviceDetection>
  readonly cleanStore?: boolean
}

const defaultScannerLayer = Layer.succeed(Scanner, {
  scanFiles: (_ignoredPaths: readonly string[], _ignoreGitignore?: boolean) =>
    Effect.succeed({ files: [], skipped: [] }),
})

const defaultEmbedderLayer = Layer.succeed(Embedder, {
  embed: () => Effect.succeed({ vector: new Float32Array(384), dims: 384, dtype: "fp32" as const }),
  batch: (texts: readonly string[]) =>
    Effect.succeed(
      texts.map(() => ({ vector: new Float32Array(384), dims: 384, dtype: "fp32" as const })),
    ),
  getFallbackInfo: () => Effect.succeed(undefined),
  createForDevice: () =>
    Effect.succeed({
      embed: () =>
        Effect.succeed({ vector: new Float32Array(384), dims: 384, dtype: "fp32" as const }),
      batch: (texts: readonly string[]) =>
        Effect.succeed(
          texts.map(() => ({
            vector: new Float32Array(384),
            dims: 384,
            dtype: "fp32" as const,
          })),
        ),
    }),
})

const defaultDeviceDetectionLayer = Layer.succeed(DeviceDetection, {
  detect: () => Effect.succeed("cpu" as const),
  detectAll: () => Effect.succeed(["cpu"] as const),
})

const defaultClipboardLayer = Layer.succeed(Clipboard, {
  copy: () => Effect.void,
})

const requireClosedLayer = <A, E>(testLayer: Layer.Layer<A, E, never>): Layer.Layer<A, E> =>
  testLayer

/**
 * Builds the full application layer for integration testing. Replaces real FileSystem with
 * in-memory variant and mocks Scanner + Embedder. Mirrors the layer structure in `src/index.ts`.
 */
export const testLayer = (opts: TestLayerOptions = {}) => {
  const {
    contents = {},
    scannerLayer,
    embedderLayer,
    configStoreLayer,
    indexStoreLayer,
    identifierExtractorLayer,
    clipboardLayer,
    queryAliasStoreLayer,
    displayLayer,
    deviceDetectionLayer,
    cleanStore,
  } = opts

  const memFs = requireClosedLayer(memoryFsLayer(contents))

  const selectedConfigStore = configStoreLayer ?? ConfigStoreLive
  const selectedIndexStore = indexStoreLayer ?? IndexStoreBase
  const configuredIndexStore = Layer.provideMerge(selectedIndexStore, selectedConfigStore)
  const configuredChunker = Layer.provideMerge(ChunkerBase, selectedConfigStore)

  const servicesLayer = Layer.mergeAll(
    selectedConfigStore,
    ModelRegistryLive,
    scannerLayer ?? defaultScannerLayer,
    embedderLayer ?? defaultEmbedderLayer,
    configuredIndexStore,
    queryAliasStoreLayer ?? QueryAliasStoreLive,
    ContentExtractorLive,
    identifierExtractorLayer ?? IdentifierExtractorLive,
    deviceDetectionLayer ?? defaultDeviceDetectionLayer,
    configuredChunker,
  )

  const infraLayer = requireClosedLayer(Layer.provideMerge(servicesLayer, memFs))

  const useCaseLayer = Layer.mergeAll(
    InitProjectLive,
    GetStatusLive,
    QueryProjectLive,
    IndexProjectLive,
    ResetIndexLive,
    BenchProjectLive,
    ClearEmbeddingCacheLive,
  )

  const appLayer = Layer.provideMerge(useCaseLayer, infraLayer)

  const baseLayers = Layer.merge(appLayer, clipboardLayer ?? defaultClipboardLayer)
  const withDisplay = requireClosedLayer(
    Layer.provideMerge(baseLayers, displayLayer ?? silentDisplay().layer),
  )
  const completeLayer = withDisplay

  if (cleanStore) {
    const cleanStoreLayer = Layer.effectDiscard(
      Effect.gen(function* () {
        const fs = yield* FileSystem
        const exists = yield* fs.exists(".pix")
        if (exists) {
          yield* fs.remove(".pix", { recursive: true })
        }
        yield* Effect.addFinalizer(() =>
          Effect.orDie(
            Effect.gen(function* () {
              const fs2 = yield* FileSystem
              const exists2 = yield* fs2.exists(".pix")
              if (exists2) yield* fs2.remove(".pix", { recursive: true })
            }),
          ),
        )
      }),
    )
    return requireClosedLayer(Layer.provideMerge(cleanStoreLayer, completeLayer))
  }

  return requireClosedLayer(completeLayer)
}
