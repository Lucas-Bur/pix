import {
  NodeChildProcessSpawner,
  NodeCrypto,
  NodePath,
  NodeStdio,
  NodeTerminal,
} from "@effect/platform-node"
import { expect } from "@effect/vitest"
import type { FileTree } from "@lucas-bur/effect-memfs"
import { Effect, Exit, Layer, Option, Ref } from "effect"
import { CliConfig, Command } from "effect/unstable/cli"

import { PixCliConfig } from "../../src/cli-config.js"
import { JsonOutput } from "../../src/cli-output.js"
import type { DisplayEntry } from "../../src/display/entries.js"
import { DEFAULT_CONFIG } from "../../src/domain/config.js"
import { ConfigError, ModelLoadError, StoreError } from "../../src/domain/errors.js"
import type { DisplaySeverity } from "../../src/domain/ports.js"
import { ConfigStore, Embedder, IndexStore } from "../../src/domain/ports.js"
import { makeEmbedding, makeStoredChunk, TEST_CONFIG_JSON } from "./fixtures.js"
import type { TestIndexSeed } from "./testLayer.js"

const commandPlatformLayer = Layer.provideMerge(
  NodeChildProcessSpawner.layer,
  Layer.mergeAll(NodeCrypto.layer, NodePath.layer, NodeStdio.layer, NodeTerminal.layer),
)

export const runCommand =
  <Name extends string, Input, ContextInput, E, R>(
    command: Command.Command<Name, Input, ContextInput, E, R>,
  ) =>
  (args: string[]) => {
    const runnable = command.pipe(Command.withGlobalFlags([JsonOutput]))
    return Command.runWith(runnable, { version: "0.0.0" })(
      args[0] === command.name ? args.slice(1) : args,
    ).pipe(
      Effect.provideService(CliConfig.CliConfig, PixCliConfig),
      Effect.provide(commandPlatformLayer),
    )
  }

export const expectLogEntry = (
  ref: Ref.Ref<ReadonlyArray<DisplayEntry>>,
  opts: { severity: DisplaySeverity; messageIncludes: string },
): Effect.Effect<void> =>
  Ref.get(ref).pipe(
    Effect.flatMap((entries) => {
      const found = entries.some(
        (e) =>
          e._tag === "log" &&
          e.severity === opts.severity &&
          e.message.includes(opts.messageIncludes),
      )
      expect(found).toBe(true)
      return Effect.void
    }),
  )

const sourceA = "const x = 1\nconst y = 2"
const sourceB = "export const z = 3"

export const indexFixtures: FileTree = {
  ".pix/config.json": TEST_CONFIG_JSON,
  "src/a.ts": sourceA,
  "src/b.ts": sourceB,
}

/** SQLite snapshot matching {@link indexFixtures}. */
export const indexSeed: TestIndexSeed = {
  chunks: [
    [
      makeStoredChunk({
        id: "a1",
        idx: 0,
        file: "src/a.ts",
        startLine: 1,
        endLine: 2,
        startOffset: 0,
        endOffset: sourceA.length,
        text: sourceA,
      }),
      makeEmbedding(0),
    ],
    [
      makeStoredChunk({
        id: "b1",
        idx: 1,
        file: "src/b.ts",
        startLine: 1,
        endLine: 1,
        startOffset: 0,
        endOffset: sourceB.length,
        text: sourceB,
      }),
      makeEmbedding(0),
    ],
  ],
  bm25Index: {
    avgChunkLength: 4,
    chunkLengths: [6, 4],
    docFreqs: { query: 2, search: 2, term: 2, test: 2 },
    chunkTfs: {
      query: [
        [0, 1],
        [1, 1],
      ],
      search: [
        [0, 1],
        [1, 1],
      ],
      term: [
        [0, 1],
        [1, 1],
      ],
      test: [
        [0, 1],
        [1, 1],
      ],
    },
  },
}

/** Assert that a command effect fails and produces error JSON recorded via SilentDisplay. */
export const assertCommandError = <E, R>(
  effect: Effect.Effect<unknown, E, R>,
  ref: Ref.Ref<ReadonlyArray<DisplayEntry>>,
  expectedCode?: string,
) =>
  Effect.gen(function* () {
    const exit = yield* Effect.exit(effect)
    expect(Exit.isFailure(exit)).toBe(true)

    const entries = yield* Ref.get(ref)
    expect(entries.length).toBeGreaterThan(0)
    const jsonEntry = [...entries].reverse().find((e) => e._tag === "json")
    expect(jsonEntry).toBeDefined()
    if (jsonEntry && jsonEntry._tag === "json") {
      const output = jsonEntry.data as { error: boolean; code: string; message: string }
      expect(output.error).toBe(true)
      if (expectedCode !== undefined) {
        expect(output.code).toBe(expectedCode)
      }
      expect(typeof output.code).toBe("string")
      expect(typeof output.message).toBe("string")
    }
  })

type FailingMethod = "persistIndex" | "loadSearchData" | "getStatus" | "reset"

/** Create an IndexStore layer where one method fails and all others succeed. */
export const makeFailingIndexStore = (
  failingMethod: FailingMethod,
  message = `${failingMethod} failed`,
): Layer.Layer<IndexStore> => {
  const failEffect = Effect.fail(new StoreError({ message }))

  return Layer.succeed(IndexStore, {
    persistIndex: () =>
      failingMethod === "persistIndex"
        ? failEffect
        : Effect.succeed({ chunks: 0, files: 0, totalLines: 0, byteSize: 0 }),
    loadSearchData:
      failingMethod === "loadSearchData"
        ? failEffect
        : Effect.succeed({
            entries: [],
            bm25Index: { avgChunkLength: 0, chunkLengths: [], docFreqs: {}, chunkTfs: {} },
            identifierIndex: { exact: {}, split: {} },
            malformedLines: 0,
          }),
    searchDense: () => Effect.succeed([]),
    searchSparse: () => Effect.succeed([]),
    loadSource: () => Effect.succeed({ text: "", contextBefore: null, contextAfter: null }),
    loadEmbeddingCache: Effect.succeed([]),
    loadSparseEmbeddingCache: Effect.succeed([]),
    clearEmbeddingCache: Effect.succeed(false),
    loadIndexSnapshot: Effect.succeed(Option.none()),
    getStatus:
      failingMethod === "getStatus"
        ? failEffect
        : Effect.succeed({
            chunks: 0,
            files: 0,
            model: "",
            lastIndex: 0,
            totalLines: 0,
            byteSize: 0,
            validationErrors: [],
            diagnostics: [],
          }),
    reset:
      failingMethod === "reset"
        ? failEffect
        : Effect.succeed({ deletedChunks: false, deletedVectors: false, freedBytes: 0 }),
  })
}

/** Find the JSON entry in SilentDisplay entries and pass its data to an assertion callback. */
export const expectJsonEntry = <T>(
  ref: Ref.Ref<ReadonlyArray<DisplayEntry>>,
  assert: (data: unknown) => T,
): Effect.Effect<T> =>
  Ref.get(ref).pipe(
    Effect.flatMap((entries) => {
      const jsonEntry = [...entries].reverse().find((e) => e._tag === "json")
      expect(jsonEntry).toBeDefined()
      if (jsonEntry?._tag === "json") {
        return Effect.succeed(assert(jsonEntry.data))
      }
      return Effect.die("No JSON entry found in display entries")
    }),
  )

/** Create a ConfigStore layer where one method fails and all others succeed. */
export const makeFailingConfigStore = (
  method: "readConfig" | "writeConfig" | "healConfig",
  message = `${method} failed`,
): Layer.Layer<ConfigStore> => {
  const fail = Effect.fail(new ConfigError({ message }))
  return Layer.succeed(ConfigStore, {
    readConfig: method === "readConfig" ? fail : Effect.succeed(DEFAULT_CONFIG),
    healConfig:
      method === "healConfig" ? fail : Effect.succeed({ config: DEFAULT_CONFIG, conflicts: [] }),
    writeConfig: () => (method === "writeConfig" ? fail : Effect.void),
    configExists: Effect.succeed(false),
  })
}

/** Create an Embedder layer where one method fails and all others succeed. */
export const makeFailingEmbedder = (
  method: "embed" | "batch",
  message = `${method} failed`,
): Layer.Layer<Embedder> => {
  const fail = Effect.fail(new ModelLoadError({ model: "test", message }))
  return Layer.succeed(Embedder, {
    limits: {
      model: "test",
      hardTokenLimit: 512,
      maxInputTokens: 512,
    },
    countTokens: () => Effect.succeed(1),
    embed: () =>
      method === "embed"
        ? fail
        : Effect.succeed({ vector: new Float32Array(384), dims: 384, dtype: "fp32" as const }),
    batch: (items) =>
      method === "batch"
        ? fail
        : Effect.succeed(
            items.map(() => ({ vector: new Float32Array(384), dims: 384, dtype: "fp32" as const })),
          ),
    getFallbackInfo: Effect.map(Effect.void, () => undefined),
    createForDevice: () =>
      Effect.succeed({
        limits: {
          model: "test",
          hardTokenLimit: 512,
          maxInputTokens: 512,
        },
        countTokens: () => Effect.succeed(1),
        embed: () =>
          Effect.succeed({ vector: new Float32Array(384), dims: 384, dtype: "fp32" as const }),
        batch: (items) =>
          Effect.succeed(
            items.map(() => ({
              vector: new Float32Array(384),
              dims: 384,
              dtype: "fp32" as const,
            })),
          ),
      }),
  })
}
