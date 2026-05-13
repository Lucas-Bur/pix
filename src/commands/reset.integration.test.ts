import { Command } from "@effect/cli"
import { Effect } from "effect"
import { expect, test } from "vite-plus/test"

import { MockConsole } from "../../tests/test-utils/MockConsole.js"
import { testLayer } from "../../tests/test-utils/testLayer.js"
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
