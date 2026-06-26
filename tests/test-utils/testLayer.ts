import { Effect, Layer } from "effect"
import { MemoryFileSystem } from "effect-memfs"
import { FileSystem } from "effect/FileSystem"

import { BenchProjectLive } from "../../src/application/bench-project.js"
import { GetStatusLive } from "../../src/application/get-status.js"
import { IndexProjectLive } from "../../src/application/index-project.js"
import { InitProjectLive } from "../../src/application/init-project.js"
import { QueryProjectLive } from "../../src/application/query-project.js"
import { ResetIndexLive } from "../../src/application/reset-index.js"
import { Display } from "../../src/domain/ports.js"
import { ConfigStore, Embedder, IndexStore, Scanner } from "../../src/domain/ports.js"
import { ChunkerLive } from "../../src/services/chunker.js"
import { ConfigStoreLive } from "../../src/services/config-store.js"
import { ContentExtractorLive } from "../../src/services/content-extractor.js"
import { IndexStoreLive } from "../../src/services/index-store.js"
import { ModelRegistryLive } from "../../src/services/models.js"

export interface TestLayerOptions {
  readonly contents?: MemoryFileSystem.Contents
  readonly scannerLayer?: Layer.Layer<Scanner, never, FileSystem>
  readonly embedderLayer?: Layer.Layer<Embedder, never, FileSystem>
  readonly configStoreLayer?: Layer.Layer<ConfigStore, never, FileSystem>
  readonly indexStoreLayer?: Layer.Layer<IndexStore, never, FileSystem>
  readonly displayLayer?: Layer.Layer<Display>
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

/**
 * Builds the full application layer for integration testing. Replaces real FileSystem with
 * in-memory variant and mocks Scanner + Embedder. Mirrors the layer structure in `src/index.ts`.
 */
export const testLayer = ((opts: TestLayerOptions = {}) => {
  const {
    contents = {},
    scannerLayer,
    embedderLayer,
    configStoreLayer,
    indexStoreLayer,
    displayLayer,
    cleanStore,
  } = opts

  const memFs = MemoryFileSystem.layerWith(contents)

  const servicesLayer = Layer.mergeAll(
    configStoreLayer ?? ConfigStoreLive,
    ModelRegistryLive,
    scannerLayer ?? defaultScannerLayer,
    embedderLayer ?? defaultEmbedderLayer,
    indexStoreLayer ?? IndexStoreLive,
    ContentExtractorLive,
  )

  const chunkerLayer = ChunkerLive.pipe(Layer.provide(servicesLayer))

  const infraLayer = Layer.mergeAll(servicesLayer, chunkerLayer).pipe(Layer.provide(memFs))

  const useCaseLayer = Layer.mergeAll(
    InitProjectLive,
    GetStatusLive,
    QueryProjectLive,
    IndexProjectLive,
    ResetIndexLive,
    BenchProjectLive,
  )

  const appLayer = Layer.merge(useCaseLayer.pipe(Layer.provide(infraLayer)), memFs)

  const baseLayers = appLayer
  const withConsole = displayLayer ? Layer.merge(baseLayers, displayLayer) : baseLayers

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
    return Layer.provideMerge(withConsole, cleanStoreLayer)
  }

  return withConsole
}) as any
