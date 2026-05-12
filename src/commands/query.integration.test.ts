import { Command } from "@effect/cli"
import { Effect, Exit, Layer } from "effect"
import { expect, test } from "vite-plus/test"

import { MockConsole } from "../../tests/test-utils/MockConsole.js"
import { testLayer } from "../../tests/test-utils/testLayer.js"
import { Embedder } from "../domain/ports.js"
import { queryCommand } from "./query.js"

const run = (args: string[]) => Command.run(queryCommand, { name: "pix", version: "0.0.0" })(args)

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
  ".pix/vectors.bin": "binary",
}

test("pix query --json outputs search results", () =>
  Effect.gen(function* () {
    yield* run(["query", "--json", "test query"])

    const { getLines } = yield* MockConsole
    const lines = yield* getLines()
    expect(lines.length).toBeGreaterThan(0)
    const output = JSON.parse(lines[0])
    expect(Array.isArray(output)).toBe(true)
  }).pipe(Effect.provide(testLayer({ contents: fixtures }))))

test("pix query with --top flag clamps to valid range", () =>
  Effect.gen(function* () {
    yield* run(["query", "--json", "--top", "3", "search term"])

    const { getLines } = yield* MockConsole
    const lines = yield* getLines()
    expect(lines.length).toBeGreaterThan(0)
    const output = JSON.parse(lines[0])
    expect(Array.isArray(output)).toBe(true)
  }).pipe(Effect.provide(testLayer({ contents: fixtures }))))

const failingEmbedderLayer = Layer.succeed(Embedder, {
  embed: () => Effect.dieMessage("embed failed"),
  batch: () => Effect.dieMessage("batch failed"),
})

test("pix query --json with failing embedder produces error JSON", () =>
  Effect.gen(function* () {
    const exit = yield* Effect.exit(run(["query", "--json", "test"]))

    const { getLines } = yield* MockConsole
    const lines = yield* getLines()
    expect(lines.length).toBeGreaterThan(0)
    const output = JSON.parse(lines[0])
    expect(output.error).toBe(true)
    expect(typeof output.code).toBe("string")
    expect(typeof output.message).toBe("string")

    expect(Exit.isFailure(exit)).toBe(true)
  }).pipe(Effect.provide(testLayer({ contents: fixtures, embedderLayer: failingEmbedderLayer }))))
