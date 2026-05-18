import { CliConfig } from "@effect/cli"
import { FileSystem } from "@effect/platform"
import { Effect, Layer } from "effect"
import { MemoryFileSystem } from "effect-memfs"

import { GetStatus } from "../../src/application/get-status.js"
import { IndexProject } from "../../src/application/index-project.js"
import { InitProject } from "../../src/application/init-project.js"
import { QueryProject } from "../../src/application/query-project.js"
import { ResetIndex } from "../../src/application/reset-index.js"
import { Display } from "../../src/domain/ports.js"
import { ConfigStore, Embedder, IndexStore, Scanner } from "../../src/domain/ports.js"
import { ChunkerLive } from "../../src/services/chunker.js"
import { ConfigStoreLive } from "../../src/services/config-store.js"
import { ContentExtractorLive } from "../../src/services/content-extractor.js"
import { IndexStoreLive } from "../../src/services/index-store.js"

export interface TestLayerOptions {
  readonly contents?: MemoryFileSystem.Contents
  readonly scannerLayer?: Layer.Layer<Scanner, never, FileSystem.FileSystem>
  readonly embedderLayer?: Layer.Layer<Embedder, never, FileSystem.FileSystem>
  readonly configStoreLayer?: Layer.Layer<ConfigStore, never, FileSystem.FileSystem>
  readonly indexStoreLayer?: Layer.Layer<IndexStore, never, FileSystem.FileSystem>
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
})

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
    displayLayer,
    cleanStore,
  } = opts

  const memFs = MemoryFileSystem.layerWith(contents)

  const servicesLayer = Layer.mergeAll(
    configStoreLayer ?? ConfigStoreLive,
    scannerLayer ?? defaultScannerLayer,
    embedderLayer ?? defaultEmbedderLayer,
    indexStoreLayer ?? IndexStoreLive,
    ContentExtractorLive,
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

  const baseLayers = Layer.mergeAll(appLayer, CliConfig.layer({ showTypes: false }))
  const withConsole = displayLayer ? Layer.merge(baseLayers, displayLayer) : baseLayers

  if (cleanStore) {
    const cleanStoreLayer = Layer.scopedDiscard(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem
        const exists = yield* fs.exists(".pix")
        if (exists) {
          yield* fs.remove(".pix", { recursive: true })
        }
        yield* Effect.addFinalizer(() =>
          Effect.orDie(
            Effect.gen(function* () {
              const fs2 = yield* FileSystem.FileSystem
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
}
