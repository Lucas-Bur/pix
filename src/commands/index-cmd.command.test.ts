import { expect, it } from "@effect/vitest"
import { Effect, Ref } from "effect"

import { expectJsonEntry, runCommand } from "../../tests/test-utils/command.js"
import { TEST_CONFIG_JSON } from "../../tests/test-utils/fixtures.js"
import { silentDisplay } from "../../tests/test-utils/silentDisplay.js"
import { testLayer } from "../../tests/test-utils/testLayer.js"
import { indexCommand } from "./index-cmd.js"

const run = runCommand(indexCommand)

const fixtures = {
  ".pix/config.json": TEST_CONFIG_JSON,
  "src/a.ts": "export const a = 1",
}

it.effect("pix index --json outputs status after indexing", () => {
  const { ref, layer } = silentDisplay()
  return Effect.gen(function* () {
    yield* run(["index", "--json"])
    const entries = yield* Ref.get(ref)
    expect(entries.some((entry) => entry._tag === "spinner")).toBe(true)
    yield* expectJsonEntry(ref, (value) => {
      const data = value as Record<string, unknown>
      expect(data.chunks).toBe(0)
      expect(data.files).toBe(0)
    })
  }).pipe(Effect.provide(testLayer({ contents: fixtures, displayLayer: layer })))
})

it.effect("pix index without --json logs status via Display", () => {
  const { ref, layer } = silentDisplay()
  return Effect.gen(function* () {
    yield* run(["index"])
    const entries = yield* Ref.get(ref)
    expect(entries.some((entry) => entry._tag === "spinner")).toBe(true)
    expect(entries.some((entry) => entry._tag === "json")).toBe(true)
    expect(entries.some((entry) => entry._tag === "log")).toBe(true)
  }).pipe(Effect.provide(testLayer({ contents: fixtures, displayLayer: layer })))
})

it.effect("pix index --json without config auto-initializes", () => {
  const { ref, layer } = silentDisplay()
  return Effect.gen(function* () {
    yield* run(["index", "--json"])
    yield* expectJsonEntry(ref, (value) => {
      expect((value as Record<string, unknown>).chunks).toBe(0)
    })
  }).pipe(Effect.provide(testLayer({ displayLayer: layer })))
})
