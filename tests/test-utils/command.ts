import { Effect, Exit, Ref } from "effect"
import type { MemoryFileSystem } from "effect-memfs"
import { expect } from "vite-plus/test"

import type { DisplayEntry } from "../../src/display/Display.js"

export const indexFixtures: MemoryFileSystem.Contents = {
  ".pix/config.json": JSON.stringify({
    schema: "1",
    embedder: { model: "test-model", device: "auto", dtype: "fp32" },
  }),
  ".pix/chunks.jsonl": [
    JSON.stringify({
      id: "a1",
      idx: 0,
      file: "/src/a.ts",
      startLine: 1,
      endLine: 2,
      text: "const x = 1\nconst y = 2",
      model: "test-model",
    }),
    JSON.stringify({
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
    const jsonEntry = entries.find((e) => e._tag === "json")
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
