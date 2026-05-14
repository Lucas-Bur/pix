import { Effect, Exit } from "effect"
import type { MemoryFileSystem } from "effect-memfs"
import { expect } from "vite-plus/test"

import { MockConsole } from "./MockConsole.js"

export const indexFixtures: MemoryFileSystem.Contents = {
  ".pix/config.json": JSON.stringify({ schemaVersion: "1" }),
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

/** Assert that a command effect fails and produces error JSON on MockConsole. */
export const assertCommandError = <E, R>(
  effect: Effect.Effect<unknown, E, R>,
  expectedCode?: string,
) =>
  Effect.gen(function* () {
    const exit = yield* Effect.exit(effect)
    expect(Exit.isFailure(exit)).toBe(true)

    const { getLines } = yield* MockConsole
    const lines = yield* getLines()
    expect(lines.length).toBeGreaterThan(0)
    const output = JSON.parse(lines[0])
    expect(output.error).toBe(true)
    if (expectedCode !== undefined) {
      expect(output.code).toBe(expectedCode)
    }
    expect(typeof output.code).toBe("string")
    expect(typeof output.message).toBe("string")
  })
