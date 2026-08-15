import { expect, it } from "@effect/vitest"
import { Effect, Layer, Ref } from "effect"

import { expectJsonEntry, runCommand } from "../../tests/test-utils/command.js"
import { TEST_CONFIG_JSON } from "../../tests/test-utils/fixtures.js"
import { silentDisplay } from "../../tests/test-utils/silentDisplay.js"
import { testLayer } from "../../tests/test-utils/testLayer.js"
import { Scanner } from "../domain/ports.js"
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

it.effect("pix index rejects non-positive resource controls", () =>
  Effect.gen(function* () {
    const invalidArgs = [
      ["index", "--batch-size", "0"],
      ["index", "--chunk-tokens", "0"],
      ["index", "--chunk-concurrency", "0"],
    ]

    for (const args of invalidArgs) {
      const exit = yield* Effect.exit(run(args))
      expect(exit._tag).toBe("Failure")
    }
  }).pipe(Effect.provide(testLayer({ contents: fixtures }))),
)

it.effect("pix index accepts repeated --ignore-path values", () =>
  Effect.gen(function* () {
    const captured = yield* Ref.make<readonly string[]>([])
    const scannerLayer = Layer.succeed(Scanner, {
      scanFiles: (ignoredPaths: readonly string[]) =>
        Ref.set(captured, ignoredPaths).pipe(Effect.as({ files: [], skipped: [] })),
    })

    yield* run(["index", "--ignore-path", "generated/**", "--ignore-path", "temp/**"]).pipe(
      Effect.provide(testLayer({ contents: fixtures, scannerLayer })),
    )

    const ignoredPaths = yield* Ref.get(captured)
    expect(ignoredPaths).toEqual(expect.arrayContaining(["generated/**", "temp/**"]))
  }),
)

it.effect("pix index accepts repeated --skip-extension values", () =>
  run(["index", "--skip-extension", ".ts", "--skip-extension", ".md"]).pipe(
    Effect.provide(testLayer({ contents: fixtures })),
  ),
)
