import { Effect } from "effect"
import { expect, test } from "vite-plus/test"

import { buildProcessorMap } from "./index.js"

test("buildProcessorMap returns chunk processor for known code extensions", () => {
  const map = buildProcessorMap([])
  expect(map[".ts"]).toBeDefined()
  expect(map[".py"]).toBeDefined()
  expect(map[".md"]).toBeDefined()
  const proc = map[".ts"]
  expect(typeof proc).toBe("function")
})

test("buildProcessorMap overrides with skipExtensions", () =>
  Effect.gen(function* () {
    const map = buildProcessorMap([".md", ".ts"])
    expect(map[".md"]).toBeDefined()
    expect(map[".ts"]).toBeDefined()
    const result = yield* Effect.either(map[".md"]("some/file.md"))
    expect(result._tag).toBe("Left")
    if (result._tag === "Left") {
      expect(result.left).toHaveProperty("_tag", "UnsupportedFormat")
    }
  }))

test("unknown extensions are not in the map", () => {
  const map = buildProcessorMap([])
  expect(map[".xyz"]).toBeUndefined()
  expect(map[".fake"]).toBeUndefined()
})
