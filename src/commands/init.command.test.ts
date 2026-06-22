import { Effect, Ref } from "effect"
import { expect, test } from "vite-plus/test"

import {
  assertCommandError,
  makeFailingConfigStore,
  runCommand,
} from "../../tests/test-utils/command.js"
import { silentDisplay } from "../../tests/test-utils/silentDisplay.js"
import { testLayer } from "../../tests/test-utils/testLayer.js"
import type { DisplayEntry } from "../display/entries.js"
import { initCommand } from "./init.js"

const run = runCommand(initCommand)

const assertInitDisplayEntries = (ref: Ref.Ref<ReadonlyArray<DisplayEntry>>) =>
  Effect.gen(function* () {
    const entries = yield* Ref.get(ref)
    expect(entries).toHaveLength(4)
    expect(entries[0]._tag).toBe("spinner")
    expect(entries[1]._tag).toBe("json")
    expect(entries[2]._tag).toBe("log")
    expect(entries[3]._tag).toBe("note")
    if (entries[1]._tag === "json") {
      const data = entries[1].data as { success: boolean; config: { embedder: { model: string } } }
      expect(data.success).toBe(true)
      expect(data.config.embedder.model).toBe("Xenova/all-MiniLM-L6-v2")
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

test("pix init --json with failing ConfigStore produces error JSON", () => {
  const { ref, layer } = silentDisplay()
  return assertCommandError(run(["init", "--json"]), ref).pipe(
    Effect.provide(
      testLayer({ configStoreLayer: makeFailingConfigStore("writeConfig"), displayLayer: layer }),
    ),
  )
})
