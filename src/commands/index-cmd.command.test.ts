import { Effect, Ref } from "effect"
import { expect, test } from "vite-plus/test"

import { assertCommandError, runCommand } from "../../tests/test-utils/command.js"
import { TEST_CONFIG_JSON } from "../../tests/test-utils/fixtures.js"
import { silentDisplay } from "../../tests/test-utils/silentDisplay.js"
import { testLayer } from "../../tests/test-utils/testLayer.js"
import { indexCommand } from "./index-cmd.js"

const run = runCommand(indexCommand)

const fixtures = {
  ".pix/config.json": TEST_CONFIG_JSON,
  "src/a.ts": "export const a = 1",
}

test("pix index --json outputs status after indexing", () => {
  const { ref, layer } = silentDisplay()
  return Effect.gen(function* () {
    yield* run(["index", "--json"])
    const entries = yield* Ref.get(ref)
    expect(entries).toHaveLength(3)
    expect(entries[0]._tag).toBe("spinner")
    expect(entries[1]._tag).toBe("json")
    expect(entries[2]._tag).toBe("log")
    if (entries[1]._tag === "json") {
      const data = entries[1].data as Record<string, unknown>
      expect(data.chunks).toBe(0)
      expect(data.files).toBe(0)
    }
  }).pipe(Effect.provide(testLayer({ contents: fixtures, displayLayer: layer })))
})

test("pix index without --json logs status via Display", () => {
  const { ref, layer } = silentDisplay()
  return Effect.gen(function* () {
    yield* run(["index"])
    const entries = yield* Ref.get(ref)
    expect(entries).toHaveLength(3)
    expect(entries[0]._tag).toBe("spinner")
    expect(entries[1]._tag).toBe("json")
    expect(entries[2]._tag).toBe("log")
  }).pipe(Effect.provide(testLayer({ contents: fixtures, displayLayer: layer })))
})

test("pix index --json without config produces error JSON", () => {
  const { ref, layer } = silentDisplay()
  return assertCommandError(run(["index", "--json"]), ref, "CONFIG_ERROR").pipe(
    Effect.provide(testLayer({ displayLayer: layer })),
  )
})
