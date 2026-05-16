import { Command } from "@effect/cli"
import { Effect, Layer, Ref } from "effect"
import { expect, test } from "vite-plus/test"

import { assertCommandError } from "../../tests/test-utils/command.js"
import { silentDisplay } from "../../tests/test-utils/silentDisplay.js"
import { testLayer } from "../../tests/test-utils/testLayer.js"
import type { DisplayEntry } from "../display/Display.js"
import { ConfigError } from "../domain/errors.js"
import { ConfigStore } from "../domain/ports.js"
import { initCommand } from "./init.js"

const run = (args: string[]) => Command.run(initCommand, { name: "pix", version: "0.0.0" })(args)

const assertInitDisplayEntries = (ref: Ref.Ref<ReadonlyArray<DisplayEntry>>) =>
  Effect.gen(function* () {
    const entries = yield* Ref.get(ref)
    expect(entries).toHaveLength(4)
    expect(entries[0]._tag).toBe("spinner")
    expect(entries[1]._tag).toBe("json")
    expect(entries[2]._tag).toBe("log")
    expect(entries[3]._tag).toBe("note")
    if (entries[1]._tag === "json") {
      const data = entries[1].data as { success: boolean; config: { schemaVersion: string } }
      expect(data.success).toBe(true)
      expect(data.config.schemaVersion).toBe("1")
    }
  })

test("pix init --json outputs config JSON via Display", () => {
  const { ref, layer } = silentDisplay()
  return Effect.gen(function* () {
    yield* run(["init", "--json"])
    yield* assertInitDisplayEntries(ref)
  }).pipe(Effect.provide(testLayer({ displayLayer: layer })))
})

test("pix init without --json shows status and note via Display", () => {
  const { ref, layer } = silentDisplay()
  return Effect.gen(function* () {
    yield* run(["init"])
    yield* assertInitDisplayEntries(ref)
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
