import { Command } from "@effect/cli"
import { Effect, Exit, Layer } from "effect"
import { expect, test } from "vite-plus/test"

import { MockConsole } from "../../tests/test-utils/MockConsole.js"
import { testLayer } from "../../tests/test-utils/testLayer.js"
import { VectorStore } from "../domain/ports.js"
import { statusCommand } from "./status.js"

const run = (args: string[]) => Command.run(statusCommand, { name: "pix", version: "0.0.0" })(args)

const fixtures = {
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

test("pix status --json outputs correct status from index files", () =>
  Effect.gen(function* () {
    yield* run(["status", "--json"])

    const { getLines } = yield* MockConsole
    const lines = yield* getLines()
    expect(lines.length).toBeGreaterThan(0)
    const output = JSON.parse(lines[0])
    expect(output.chunks).toBe(2)
    expect(output.files).toBe(2)
    expect(output.model).toBe("test-model")
    expect(output.totalLines).toBe(3)
  }).pipe(Effect.provide(testLayer({ contents: fixtures }))))

test("pix status --json on empty project shows zero status", () =>
  Effect.gen(function* () {
    yield* run(["status", "--json"])

    const { getLines } = yield* MockConsole
    const lines = yield* getLines()
    const output = JSON.parse(lines[0])
    expect(output.chunks).toBe(0)
    expect(output.files).toBe(0)
    expect(output.totalLines).toBe(0)
  }).pipe(Effect.provide(testLayer())))

test("pix status without --json logs info via Effect.logInfo", () =>
  Effect.gen(function* () {
    yield* run(["status"])
    const { getLines } = yield* MockConsole
    const lines = yield* getLines()
    // logInfo writes to logger, not to Console.log via MockConsole
    expect(lines.length).toBe(0)
  }).pipe(Effect.provide(testLayer({ contents: fixtures }))))

const failingVectorStore = Layer.succeed(VectorStore, {
  store: () => Effect.succeed(undefined),
  search: () => Effect.succeed([]),
  getStatus: () => Effect.dieMessage("getStatus failed"),
  reset: () => Effect.succeed({ deletedChunks: false, deletedVectors: false, freedBytes: 0 }),
})

test("pix status --json with failing VectorStore produces error JSON", () =>
  Effect.gen(function* () {
    const exit = yield* Effect.exit(run(["status", "--json"]))
    expect(Exit.isFailure(exit)).toBe(true)

    const { getLines } = yield* MockConsole
    const lines = yield* getLines()
    expect(lines.length).toBeGreaterThan(0)
    const output = JSON.parse(lines[0])
    expect(output.error).toBe(true)
    expect(typeof output.code).toBe("string")
    expect(typeof output.message).toBe("string")
  }).pipe(Effect.provide(testLayer({ vectorStoreLayer: failingVectorStore }))))
