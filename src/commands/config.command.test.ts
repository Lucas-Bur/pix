import { expect, it } from "@effect/vitest"
import { Effect, Ref } from "effect"

import { assertCommandError, runCommand } from "../../tests/test-utils/command.js"
import { makeConfigJson } from "../../tests/test-utils/fixtures.js"
import { silentDisplay } from "../../tests/test-utils/silentDisplay.js"
import { testLayer } from "../../tests/test-utils/testLayer.js"
import { healCommand } from "./config.js"

const run = runCommand(healCommand)

it.effect("pix config heal --json with healthy config emits success", () => {
  const { ref, layer } = silentDisplay()
  return Effect.gen(function* () {
    yield* run(["heal", "--json"])
    const entries = yield* Ref.get(ref)
    const jsonEntry = entries.find((e) => e._tag === "json")
    expect(jsonEntry).toBeDefined()
    if (jsonEntry && jsonEntry._tag === "json") {
      const data = jsonEntry.data as {
        conflicts: unknown[]
        config: { embedder: { model: string } }
      }
      expect(data.conflicts).toHaveLength(0)
      expect(data.config.embedder.model).toBe("Xenova/all-MiniLM-L6-v2")
    }
    const logEntries = entries.filter((e) => e._tag === "log")
    expect(logEntries.some((e) => e._tag === "log" && e.severity === "success")).toBe(true)
  }).pipe(
    Effect.provide(
      testLayer({
        contents: { ".pix/config.json": makeConfigJson() },
        displayLayer: layer,
      }),
    ),
  )
})

it.effect("pix config heal heals unsupported dtype with default", () => {
  const { ref, layer } = silentDisplay()
  return Effect.gen(function* () {
    yield* run(["heal"])
    const entries = yield* Ref.get(ref)
    const jsonEntry = entries.find((e) => e._tag === "json")
    expect(jsonEntry).toBeDefined()
    if (jsonEntry && jsonEntry._tag === "json") {
      const data = jsonEntry.data as {
        conflicts: Array<{ field: string; healed: boolean }>
        config: { embedder: { dtype: string } }
      }
      expect(data.conflicts).toHaveLength(1)
      expect(data.conflicts[0].field).toBe("embedder.dtype")
      expect(data.conflicts[0].healed).toBe(true)
      expect(data.config.embedder.dtype).toBe("fp32")
    }
  }).pipe(
    Effect.provide(
      testLayer({
        contents: { ".pix/config.json": makeConfigJson({ embedder: { dtype: "q4" } }) },
        displayLayer: layer,
      }),
    ),
  )
})

it.effect("pix config heal --json fails on unknown model with ConfigHealError", () => {
  const { ref, layer } = silentDisplay()
  return assertCommandError(run(["heal", "--json"]), ref).pipe(
    Effect.provide(
      testLayer({
        contents: { ".pix/config.json": makeConfigJson({ embedder: { model: "foo/bar" } }) },
        displayLayer: layer,
      }),
    ),
  )
})
