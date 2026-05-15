import { Command } from "@effect/cli"
import { Effect, Layer, Ref } from "effect"
import { expect, test } from "vite-plus/test"

import { assertCommandError } from "../../tests/test-utils/command.js"
import { silentDisplay } from "../../tests/test-utils/silentDisplay.js"
import { testLayer } from "../../tests/test-utils/testLayer.js"
import { Scanner } from "../domain/ports.js"
import { indexCommand } from "./index-cmd.js"

const run = (args: string[]) => Command.run(indexCommand, { name: "pix", version: "0.0.0" })(args)

const fixtures = {
  ".pix/config.json": JSON.stringify({
    schema: "1",
    embedder: { model: "test-model", device: "auto", dtype: "fp32" },
    chunkLines: 60,
    overlapLines: 10,
    files: {},
  }),
  "src/a.ts": "export const a = 1",
}

const emptyScannerLayer = Layer.succeed(Scanner, {
  scanFiles: () => Effect.succeed({ files: [], skipped: [] }),
})

test("pix index --json outputs status after indexing", () => {
  const { ref, layer } = silentDisplay()
  return Effect.gen(function* () {
    yield* run(["index", "--json"])
    const entries = yield* Ref.get(ref)
    expect(entries).toHaveLength(1)
    expect(entries[0]._tag).toBe("json")
    if (entries[0]._tag === "json") {
      const data = entries[0].data as Record<string, unknown>
      expect(data.chunks).toBe(0)
      expect(data.files).toBe(0)
    }
  }).pipe(
    Effect.provide(
      testLayer({ contents: fixtures, scannerLayer: emptyScannerLayer, displayLayer: layer }),
    ),
  )
})

test("pix index without --json logs status via Display", () => {
  const { ref, layer } = silentDisplay()
  return Effect.gen(function* () {
    yield* run(["index"])
    const entries = yield* Ref.get(ref)
    expect(entries[0]._tag).toBe("json")
    expect(entries.some((e) => e._tag === "status")).toBe(true)
  }).pipe(
    Effect.provide(
      testLayer({ contents: fixtures, scannerLayer: emptyScannerLayer, displayLayer: layer }),
    ),
  )
})

test("pix index --json without config produces error JSON", () => {
  const { ref, layer } = silentDisplay()
  return assertCommandError(run(["index", "--json"]), ref, "CONFIG_ERROR").pipe(
    Effect.provide(testLayer({ displayLayer: layer })),
  )
})

test("pix index --force shows warning via Display", () => {
  const { ref, layer } = silentDisplay()
  return Effect.gen(function* () {
    yield* run(["index", "--force"])
    const entries = yield* Ref.get(ref)
    expect(entries.some((e) => e._tag === "status" && e.severity === "warn")).toBe(true)
  }).pipe(
    Effect.provide(
      testLayer({ contents: fixtures, scannerLayer: emptyScannerLayer, displayLayer: layer }),
    ),
  )
})

test("pix index --verbose shows warning via Display", () => {
  const { ref, layer } = silentDisplay()
  return Effect.gen(function* () {
    yield* run(["index", "--verbose"])
    const entries = yield* Ref.get(ref)
    expect(entries.some((e) => e._tag === "status" && e.severity === "warn")).toBe(true)
  }).pipe(
    Effect.provide(
      testLayer({ contents: fixtures, scannerLayer: emptyScannerLayer, displayLayer: layer }),
    ),
  )
})
