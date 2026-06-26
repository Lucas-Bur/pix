import { Effect, Result } from "effect"
import { expect, test } from "vite-plus/test"

import { buildProcessorMap } from "./processors.js"

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
    const result = yield* Effect.result(map[".md"]("some/file.md"))
    expect(Result.isFailure(result)).toBe(true)
    if (Result.isFailure(result)) {
      expect(result.failure).toHaveProperty("_tag", "UnsupportedFormat")
    }
  }))

test("unknown extensions are not in the map", () => {
  const map = buildProcessorMap([])
  expect(map[".xyz"]).toBeUndefined()
  expect(map[".fake"]).toBeUndefined()
})
