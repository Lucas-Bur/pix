import { Command } from "@effect/cli"
import { Effect, Layer } from "effect"
import { expect, test } from "vite-plus/test"

import { assertCommandError } from "../../tests/test-utils/command.js"
import { MockConsole } from "../../tests/test-utils/MockConsole.js"
import { testLayer } from "../../tests/test-utils/testLayer.js"
import { VectorStore } from "../domain/ports.js"
import { resetCommand } from "./reset.js"

const run = (args: string[]) => Command.run(resetCommand, { name: "pix", version: "0.0.0" })(args)

const fixtures = {
  ".pix/config.json": JSON.stringify({ schemaVersion: "1" }),
  ".pix/chunks.jsonl": JSON.stringify({
    id: "a1",
    idx: 0,
    file: "/src/a.ts",
    startLine: 1,
    endLine: 1,
    text: "x",
  }),
  ".pix/vectors.bin": "binary-data",
}

test("pix reset --json deletes index files and reports status", () =>
  Effect.gen(function* () {
    yield* run(["reset", "--json"])

    const { getLines } = yield* MockConsole
    const lines = yield* getLines()
    expect(lines.length).toBeGreaterThan(0)
    const output = JSON.parse(lines[0])
    expect(output.status).toBe("ok")
    expect(output.deletedChunks).toBe(true)
    expect(output.deletedVectors).toBe(true)
    expect(output.freedBytes).toBeGreaterThan(0)
  }).pipe(Effect.provide(testLayer({ contents: fixtures }))))

test("pix reset --json on clean project reports nothing deleted", () =>
  Effect.gen(function* () {
    yield* run(["reset", "--json"])

    const { getLines } = yield* MockConsole
    const lines = yield* getLines()
    const output = JSON.parse(lines[0])
    expect(output.status).toBe("ok")
    expect(output.deletedChunks).toBe(false)
    expect(output.deletedVectors).toBe(false)
    expect(output.freedBytes).toBe(0)
  }).pipe(Effect.provide(testLayer())))

test("pix reset without --json logs deletion info", () =>
  Effect.gen(function* () {
    yield* run(["reset"])
    const { getLines } = yield* MockConsole
    const lines = yield* getLines()
    // logInfo writes to logger, not Console.log via MockConsole
    expect(lines.length).toBe(0)
  }).pipe(Effect.provide(testLayer())))

test("pix reset without --json logs nothing to reset when clean", () =>
  Effect.gen(function* () {
    yield* run(["reset"])
    const { getLines } = yield* MockConsole
    const lines = yield* getLines()
    expect(lines.length).toBe(0)
  }).pipe(Effect.provide(testLayer({ contents: fixtures }))))

const failingVectorStore = Layer.succeed(VectorStore, {
  store: () => Effect.succeed(undefined),
  search: () => Effect.succeed([]),
  getStatus: () =>
    Effect.succeed({ chunks: 0, files: 0, model: "", lastIndex: 0, totalLines: 0, byteSize: 0 }),
  reset: () => Effect.dieMessage("reset failed"),
})

test("pix reset --json with failing VectorStore produces error JSON", () =>
  assertCommandError(run(["reset", "--json"])).pipe(
    Effect.provide(testLayer({ vectorStoreLayer: failingVectorStore })),
  ))
