import { Effect, Ref } from "effect"
import { expect, test } from "vite-plus/test"

import {
  assertCommandError,
  expectJsonEntry,
  indexFixtures,
  makeFailingVectorStore,
  runCommand,
} from "../../tests/test-utils/command.js"
import { silentDisplay } from "../../tests/test-utils/silentDisplay.js"
import { testLayer } from "../../tests/test-utils/testLayer.js"
import { statusCommand } from "./status.js"

const run = runCommand(statusCommand)

test("pix status --json outputs correct status from index files", () => {
  const { ref, layer } = silentDisplay()
  return Effect.gen(function* () {
    yield* run(["status", "--json"])
    const entries = yield* Ref.get(ref)
    expect(entries).toHaveLength(1)
    expect(entries[0]._tag).toBe("json")
    if (entries[0]._tag === "json") {
      const data = entries[0].data as Record<string, unknown>
      expect(data.chunks).toBe(2)
      expect(data.files).toBe(2)
      expect(data.model).toBe("test-model")
      expect(data.totalLines).toBe(3)
    }
  }).pipe(Effect.provide(testLayer({ contents: indexFixtures, displayLayer: layer })))
})

test("pix status --json on empty project shows zero status", () => {
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

test("pix status without --json logs status entries via Display", () => {
  const { ref, layer } = silentDisplay()
  return Effect.gen(function* () {
    yield* run(["status"])
    const entries = yield* Ref.get(ref)
    expect(entries.some((e) => e._tag === "json")).toBe(true)
    expect(entries.filter((e) => e._tag === "log").length).toBe(5)
  }).pipe(Effect.provide(testLayer({ contents: indexFixtures, displayLayer: layer })))
})

test("pix status --json with failing VectorStore produces error JSON", () => {
  const { ref, layer } = silentDisplay()
  return assertCommandError(run(["status", "--json"]), ref).pipe(
    Effect.provide(
      testLayer({ vectorStoreLayer: makeFailingVectorStore("getStatus"), displayLayer: layer }),
    ),
  )
})
