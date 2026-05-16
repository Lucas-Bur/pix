import { Effect, Exit, Layer, Ref } from "effect"
import type { MemoryFileSystem } from "effect-memfs"
import { expect } from "vite-plus/test"

import type { DisplayEntry } from "../../src/display/Display.js"
import { StoreError } from "../../src/domain/errors.js"
import { VectorStore } from "../../src/domain/ports.js"
import { makeChunkJson, makeConfigJson } from "./fixtures.js"

export const indexFixtures: MemoryFileSystem.Contents = {
  ".pix/config.json": makeConfigJson(),
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
  | "store"
  | "storeBegin"
  | "storeBatch"
  | "storeCommit"
  | "storeAbort"
  | "search"
  | "getStatus"
  | "reset"

/** Create a VectorStore layer where one method fails and all others succeed. */
export const makeFailingVectorStore = (
  failingMethod: FailingMethod,
  message = `${failingMethod} failed`,
): Layer.Layer<VectorStore> => {
  const failEffect = Effect.fail(new StoreError({ message }))

  return Layer.succeed(VectorStore, {
    store: () => (failingMethod === "store" ? failEffect : Effect.void),
    storeBegin: () => (failingMethod === "storeBegin" ? failEffect : Effect.void),
    storeBatch: () => (failingMethod === "storeBatch" ? failEffect : Effect.void),
    storeCommit: () =>
      failingMethod === "storeCommit"
        ? failEffect
        : Effect.succeed({ chunks: 0, files: 0, totalLines: 0, byteSize: 0 }),
    storeAbort: () => (failingMethod === "storeAbort" ? failEffect : Effect.void),
    search: () =>
      failingMethod === "search"
        ? failEffect
        : Effect.succeed({ results: [], validationErrors: [] }),
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
