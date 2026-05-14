import { Command } from "@effect/cli"
import { Effect, Layer } from "effect"
import { expect, test } from "vite-plus/test"

import { assertCommandError } from "../../tests/test-utils/command.js"
import { MockConsole } from "../../tests/test-utils/MockConsole.js"
import { testLayer } from "../../tests/test-utils/testLayer.js"
import { ConfigStore } from "../domain/ports.js"
import { initCommand } from "./init.js"

const run = (args: string[]) => Command.run(initCommand, { name: "pix", version: "0.0.0" })(args)

test("pix init --json outputs config JSON on stdout", () =>
  Effect.gen(function* () {
    yield* run(["init", "--json"])

    const { getLines } = yield* MockConsole
    const lines = yield* getLines()
    expect(lines.length).toBeGreaterThan(0)
    const output = JSON.parse(lines[0])
    expect(output.success).toBe(true)
    expect(output.config.schemaVersion).toBe("1")
  }).pipe(Effect.provide(testLayer())))

test("pix init without --json does not write to Console", () =>
  Effect.gen(function* () {
    yield* run(["init"])

    const { getLines } = yield* MockConsole
    const lines = yield* getLines()
    expect(lines.length).toBe(0)
  }).pipe(Effect.provide(testLayer())))

const failingConfigStore = Layer.succeed(ConfigStore, {
  writeConfig: () => Effect.dieMessage("writeConfig failed"),
  readConfig: () => Effect.dieMessage("readConfig failed"),
  configExists: () => Effect.succeed(false),
})

test("pix init --json with failing ConfigStore produces error JSON", () =>
  assertCommandError(run(["init", "--json"])).pipe(
    Effect.provide(testLayer({ configStoreLayer: failingConfigStore })),
  ))
