import { Effect, Ref } from "effect"
import { expect, test } from "vite-plus/test"

import {
  assertCommandError,
  expectJsonEntry,
  makeFailingIndexStore,
  runCommand,
} from "../../tests/test-utils/command.js"
import { makeChunkJson, TEST_CONFIG_JSON } from "../../tests/test-utils/fixtures.js"
import { silentDisplay } from "../../tests/test-utils/silentDisplay.js"
import { testLayer } from "../../tests/test-utils/testLayer.js"
import { resetCommand } from "./reset.js"

const run = runCommand(resetCommand)

const fixtures = {
  ".pix/config.json": TEST_CONFIG_JSON,
  ".pix/chunks.jsonl": makeChunkJson({
    id: "a1",
    idx: 0,
    file: "/src/a.ts",
    startLine: 1,
    endLine: 1,
    text: "x",
  }),
  ".pix/vectors.bin": "binary-data",
}

test("pix reset --json deletes index files and reports status", () => {
  const { ref, layer } = silentDisplay()
  return Effect.gen(function* () {
    yield* run(["reset", "--json"])
    const entries = yield* Ref.get(ref)
    expect(entries[0]._tag).toBe("spinner")
    yield* expectJsonEntry(ref, (data) => {
      const d = data as Record<string, unknown>
      expect(d.status).toBe("ok")
      expect(d.deletedChunks).toBe(true)
      expect(d.deletedVectors).toBe(true)
      expect(d.freedBytes).toBeGreaterThan(0)
    })
  }).pipe(Effect.provide(testLayer({ contents: fixtures, displayLayer: layer })))
})

test("pix reset --json on clean project reports nothing deleted", () => {
  const { ref, layer } = silentDisplay()
  return Effect.gen(function* () {
    yield* run(["reset", "--json"])
    const entries = yield* Ref.get(ref)
    expect(entries[0]._tag).toBe("spinner")
    yield* expectJsonEntry(ref, (data) => {
      const d = data as Record<string, unknown>
      expect(d.status).toBe("ok")
      expect(d.deletedChunks).toBe(false)
      expect(d.deletedVectors).toBe(false)
      expect(d.freedBytes).toBe(0)
    })
  }).pipe(Effect.provide(testLayer({ displayLayer: layer })))
})

test("pix reset without --json logs status entries via Display", () => {
  const { ref, layer } = silentDisplay()
  return Effect.gen(function* () {
    yield* run(["reset"])
    const entries = yield* Ref.get(ref)
    expect(entries.some((e) => e._tag === "spinner")).toBe(true)
    expect(entries.some((e) => e._tag === "json")).toBe(true)
    expect(entries.some((e) => e._tag === "log")).toBe(true)
  }).pipe(Effect.provide(testLayer({ contents: fixtures, displayLayer: layer })))
})

test("pix reset without --json on clean project shows info", () => {
  const { ref, layer } = silentDisplay()
  return Effect.gen(function* () {
    yield* run(["reset"])
    const entries = yield* Ref.get(ref)
    expect(entries.some((e) => e._tag === "spinner")).toBe(true)
    expect(entries.some((e) => e._tag === "json")).toBe(true)
    expect(entries.some((e) => e._tag === "log")).toBe(true)
  }).pipe(Effect.provide(testLayer({ displayLayer: layer })))
})

test("pix reset --json with failing IndexStore produces error JSON", () => {
  const { ref, layer } = silentDisplay()
  return assertCommandError(run(["reset", "--json"]), ref).pipe(
    Effect.provide(
      testLayer({ indexStoreLayer: makeFailingIndexStore("reset"), displayLayer: layer }),
    ),
  )
})
