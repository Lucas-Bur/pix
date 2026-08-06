import { expect, it } from "@effect/vitest"
import { Effect, Layer, Ref } from "effect"

import {
  assertCommandError,
  expectJsonEntry,
  makeFailingIndexStore,
  runCommand,
} from "../../tests/test-utils/command.js"
import { silentDisplay } from "../../tests/test-utils/silentDisplay.js"
import { testLayer } from "../../tests/test-utils/testLayer.js"
import { IndexStore } from "../domain/ports.js"
import { statusCommand } from "./status.js"

const run = runCommand(statusCommand)
const populatedStatusLayer = Layer.mock(IndexStore)({
  getStatus: () =>
    Effect.succeed({
      chunks: 2,
      files: 2,
      model: "test-model",
      lastIndex: Date.now(),
      totalLines: 3,
      byteSize: 19,
      validationErrors: [],
      diagnostics: [{ kind: "parser-fallback", file: "src/test.ts", message: "fallback" }],
    }),
})

it.effect("pix status --json outputs correct status from index files", () => {
  const { ref, layer } = silentDisplay()
  return Effect.gen(function* () {
    yield* run(["status", "--json"])
    yield* expectJsonEntry(ref, (value) => {
      const data = value as Record<string, unknown>
      expect(data.chunks).toBe(2)
      expect(data.files).toBe(2)
      expect(data.model).toBe("test-model")
      expect(data.totalLines).toBe(3)
    })
  }).pipe(Effect.provide(testLayer({ indexStoreLayer: populatedStatusLayer, displayLayer: layer })))
})

it.effect("pix status --json on empty project shows zero status", () => {
  const { ref, layer } = silentDisplay()
  return Effect.gen(function* () {
    yield* run(["status", "--json"])
    yield* expectJsonEntry(ref, (data) => {
      const d = data as Record<string, unknown>
      expect(d.chunks).toBe(0)
      expect(d.files).toBe(0)
      expect(d.totalLines).toBe(0)
    })
  }).pipe(Effect.provide(testLayer({ displayLayer: layer })))
})

it.effect("pix status without --json logs status entries via Display", () => {
  const { ref, layer } = silentDisplay()
  return Effect.gen(function* () {
    yield* run(["status"])
    const entries = yield* Ref.get(ref)
    expect(entries.some((e) => e._tag === "json")).toBe(true)
    expect(
      entries.some((entry) => entry._tag === "log" && entry.message.includes("Indexed: 2 chunks")),
    ).toBe(true)
    expect(
      entries.some((entry) => entry._tag === "log" && entry.message === "Index diagnostics: 1"),
    ).toBe(true)
  }).pipe(Effect.provide(testLayer({ indexStoreLayer: populatedStatusLayer, displayLayer: layer })))
})

it.effect("pix status --json with failing IndexStore produces error JSON", () => {
  const { ref, layer } = silentDisplay()
  return assertCommandError(run(["status", "--json"]), ref).pipe(
    Effect.provide(
      testLayer({ indexStoreLayer: makeFailingIndexStore("getStatus"), displayLayer: layer }),
    ),
  )
})
