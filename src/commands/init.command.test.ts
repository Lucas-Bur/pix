import { expect, it } from "@effect/vitest"
import { Effect, Ref } from "effect"

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

const assertInitDisplayEntries = (
  ref: Ref.Ref<ReadonlyArray<DisplayEntry>>,
  expectedModel = "Xenova/all-MiniLM-L6-v2",
) =>
  Effect.gen(function* () {
    const entries = yield* Ref.get(ref)
    expect(entries.some((entry) => entry._tag === "spinner")).toBe(true)
    expect(entries.some((entry) => entry._tag === "log")).toBe(true)
    expect(entries.some((entry) => entry._tag === "note")).toBe(false)
    const jsonEntry = entries.find((entry) => entry._tag === "json")
    expect(jsonEntry).toBeDefined()
    if (jsonEntry?._tag === "json") {
      const data = jsonEntry.data as { success: boolean; config: { embedder: { model: string } } }
      expect(data.success).toBe(true)
      expect(data.config.embedder.model).toBe(expectedModel)
    }
  })

it.effect("pix init --json outputs config JSON via Display", () => {
  const { ref, layer } = silentDisplay()
  return Effect.gen(function* () {
    yield* run(["init", "--json"])
    yield* assertInitDisplayEntries(ref)
  }).pipe(Effect.provide(testLayer({ displayLayer: layer })))
})

it.effect("pix init without --json shows status via Display", () => {
  const { ref, layer } = silentDisplay()
  return Effect.gen(function* () {
    yield* run(["init"])
    yield* assertInitDisplayEntries(ref)
  }).pipe(Effect.provide(testLayer({ displayLayer: layer })))
})

it.effect("pix init --model selects a model without prompting", () => {
  const { ref, layer } = silentDisplay()
  return Effect.gen(function* () {
    yield* run(["init", "--model", "Xenova/bge-small-en-v1.5"])
    yield* assertInitDisplayEntries(ref, "Xenova/bge-small-en-v1.5")

    const entries = yield* Ref.get(ref)
    expect(entries.some((entry) => entry._tag === "select")).toBe(false)
  }).pipe(Effect.provide(testLayer({ displayLayer: layer })))
})

it.effect("pix init --json with failing ConfigStore produces error JSON", () => {
  const { ref, layer } = silentDisplay()
  return assertCommandError(run(["init", "--json"]), ref).pipe(
    Effect.provide(
      testLayer({ configStoreLayer: makeFailingConfigStore("writeConfig"), displayLayer: layer }),
    ),
  )
})
