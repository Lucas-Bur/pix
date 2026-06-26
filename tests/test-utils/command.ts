import { Effect, Exit, Layer, Ref } from "effect"
import type { MemoryFileSystem } from "effect-memfs"
import { Command } from "effect/unstable/cli"
import { expect } from "vite-plus/test"

import type { DisplayEntry } from "../../src/display/entries.js"
import { DEFAULT_CONFIG } from "../../src/domain/config.js"
import { ConfigError, ModelLoadError, StoreError } from "../../src/domain/errors.js"
import type { DisplaySeverity } from "../../src/domain/ports.js"
import { ConfigStore, Embedder, IndexStore } from "../../src/domain/ports.js"
import { makeChunkJson, TEST_CONFIG_JSON } from "./fixtures.js"

export const runCommand =
  <Name extends string, Input, ContextInput, E, R>(
    command: Command.Command<Name, Input, ContextInput, E, R>,
  ) =>
  (args: string[]) =>
    Command.runWith(command, { version: "0.0.0" })(args)

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

export const indexFixtures: MemoryFileSystem.Contents = {
  ".pix/config.json": TEST_CONFIG_JSON,
  ".pix/index-meta.json": JSON.stringify({
    dtype: "fp32",
    dims: 384,
    model: "test-model",
    lastIndex: Date.now(),
  }),
  ".pix/chunks.jsonl": [
    makeChunkJson({
      id: "a1",
      idx: 0,
      file: "/src/a.ts",
      startLine: 1,
      endLine: 2,
      text: "const x = 1\nconst y = 2",
    }),
    makeChunkJson({
      id: "b1",
      idx: 1,
      file: "/src/b.ts",
      startLine: 1,
      endLine: 1,
      text: "export const z = 3",
    }),
  ].join("\n"),
  ".pix/vectors.bin": "fake binary content",
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

type FailingMethod =
  | "storeBegin"
  | "storeBatch"
  | "storeCommit"
  | "storeAbort"
  | "loadSearchData"
  | "getStatus"
  | "reset"

/** Create an IndexStore layer where one method fails and all others succeed. */
export const makeFailingIndexStore = (
  failingMethod: FailingMethod,
  message = `${failingMethod} failed`,
): Layer.Layer<IndexStore> => {
  const failEffect = Effect.fail(new StoreError({ message }))

  return Layer.succeed(IndexStore, {
    storeBegin: () => (failingMethod === "storeBegin" ? failEffect : Effect.void),
    storeBatch: () => (failingMethod === "storeBatch" ? failEffect : Effect.void),
    storeCommit: () =>
      failingMethod === "storeCommit"
        ? failEffect
        : Effect.succeed({ chunks: 0, files: 0, totalLines: 0, byteSize: 0 }),
    storeAbort: () => (failingMethod === "storeAbort" ? failEffect : Effect.void),
    loadSearchData: () =>
      failingMethod === "loadSearchData"
        ? failEffect
        : Effect.succeed({
            entries: [],
            bm25Index: { avgChunkLength: 0, chunkLengths: [], docFreqs: {}, chunkTfs: {} },
            malformedLines: 0,
          }),
    getStatus: () =>
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
          }),
    reset: () =>
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
    readConfig: () => (method === "readConfig" ? fail : Effect.succeed(DEFAULT_CONFIG)),
    readConfigWithConflicts: () =>
      method === "readConfig" ? fail : Effect.succeed({ config: DEFAULT_CONFIG, conflicts: [] }),
    healConfig: () =>
      method === "healConfig" ? fail : Effect.succeed({ config: DEFAULT_CONFIG, conflicts: [] }),
    writeConfig: () => (method === "writeConfig" ? fail : Effect.void),
    configExists: () => Effect.succeed(false),
  })
}

/** Create an Embedder layer where one method fails and all others succeed. */
export const makeFailingEmbedder = (
  method: "embed" | "batch",
  message = `${method} failed`,
): Layer.Layer<Embedder> => {
  const fail = Effect.fail(new ModelLoadError({ model: "test", message }))
  return Layer.succeed(Embedder, {
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
    getFallbackInfo: () => Effect.succeed(undefined),
    createForDevice: () =>
      Effect.succeed({
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
