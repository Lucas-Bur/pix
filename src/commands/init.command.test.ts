import { Command } from "@effect/cli"
import { Effect, Layer, Ref } from "effect"
import { expect, test } from "vite-plus/test"

import { assertCommandError } from "../../tests/test-utils/command.js"
import { silentDisplay } from "../../tests/test-utils/silentDisplay.js"
import { testLayer } from "../../tests/test-utils/testLayer.js"
import { ConfigError } from "../domain/config.js"
import { ConfigStore } from "../domain/ports.js"
import { initCommand } from "./init.js"

const run = (args: string[]) => Command.run(initCommand, { name: "pix", version: "0.0.0" })(args)

test("pix init --json outputs config JSON via Display", () => {
  const { ref, layer } = silentDisplay()
  return Effect.gen(function* () {
    yield* run(["init", "--json"])
    const entries = yield* Ref.get(ref)
    expect(entries).toHaveLength(1)
    expect(entries[0]._tag).toBe("json")
    if (entries[0]._tag === "json") {
      const data = entries[0].data as { success: boolean; config: { schemaVersion: string } }
      expect(data.success).toBe(true)
      expect(data.config.schemaVersion).toBe("1")
    }
  }).pipe(Effect.provide(testLayer({ displayLayer: layer })))
})

test("pix init without --json shows status and note via Display", () => {
  const { ref, layer } = silentDisplay()
  return Effect.gen(function* () {
    yield* run(["init"])
    const entries = yield* Ref.get(ref)
    expect(entries.length).toBe(2)
    expect(entries[0]._tag).toBe("log")
    expect(entries[1]._tag).toBe("note")
  }).pipe(Effect.provide(testLayer({ displayLayer: layer })))
})

const failingConfigStore = Layer.succeed(ConfigStore, {
  writeConfig: () => Effect.fail(new ConfigError({ message: "writeConfig failed" })),
  readConfig: () => Effect.fail(new ConfigError({ message: "readConfig failed" })),
  configExists: () => Effect.succeed(false),
})

test("pix init --json with failing ConfigStore produces error JSON", () => {
  const { ref, layer } = silentDisplay()
  return assertCommandError(run(["init", "--json"]), ref).pipe(
    Effect.provide(testLayer({ configStoreLayer: failingConfigStore, displayLayer: layer })),
  )
})
