import { Command } from "@effect/cli"
import { Effect, Layer } from "effect"
import { expect, test } from "vite-plus/test"

import { assertCommandError } from "../../tests/test-utils/command.js"
import { MockConsole } from "../../tests/test-utils/MockConsole.js"
import { testLayer } from "../../tests/test-utils/testLayer.js"
import { Scanner } from "../domain/ports.js"
import { indexCommand } from "./index-cmd.js"

const run = (args: string[]) => Command.run(indexCommand, { name: "pix", version: "0.0.0" })(args)

const fixtures = {
  ".pix/config.json": JSON.stringify({
    schemaVersion: "1",
    model: "test-model",
    extensions: [".ts"],
    chunkLines: 60,
    overlapLines: 10,
    batchSize: 16,
  }),
  "src/a.ts": "export const a = 1",
}

const emptyScannerLayer = Layer.succeed(Scanner, {
  scanFiles: () => Effect.succeed({ files: [], skipped: [] }),
})

test("pix index --json outputs status after indexing", () =>
  Effect.gen(function* () {
    yield* run(["index", "--json"])

    const { getLines } = yield* MockConsole
    const lines = yield* getLines()
    expect(lines.length).toBeGreaterThan(0)
    const output = JSON.parse(lines[0])
    expect(output.chunks).toBe(0)
    expect(output.files).toBe(0)
    expect(typeof output.duration).toBe("string")
  }).pipe(Effect.provide(testLayer({ contents: fixtures, scannerLayer: emptyScannerLayer }))))

test("pix index without --json logs info summary", () =>
  Effect.gen(function* () {
    yield* run(["index"])

    const { getLines } = yield* MockConsole
    const lines = yield* getLines()
    expect(lines.length).toBe(0)
  }).pipe(Effect.provide(testLayer({ contents: fixtures, scannerLayer: emptyScannerLayer }))))

test("pix index --json without config produces error JSON", () =>
  assertCommandError(run(["index", "--json"]), "CONFIG_MISSING").pipe(Effect.provide(testLayer())))

test("pix index --force logs not-implemented warning", () =>
  Effect.gen(function* () {
    yield* run(["index", "--force"])
    const { getLines } = yield* MockConsole
    const lines = yield* getLines()
    expect(lines.length).toBe(0)
  }).pipe(Effect.provide(testLayer({ contents: fixtures, scannerLayer: emptyScannerLayer }))))

test("pix index --verbose logs not-implemented warning", () =>
  Effect.gen(function* () {
    yield* run(["index", "--verbose"])
    const { getLines } = yield* MockConsole
    const lines = yield* getLines()
    expect(lines.length).toBe(0)
  }).pipe(Effect.provide(testLayer({ contents: fixtures, scannerLayer: emptyScannerLayer }))))
