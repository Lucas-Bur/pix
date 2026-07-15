import { expect, test } from "@effect/vitest"

import { contentHash } from "./content-hash.js"

test("contentHash is stable and content-sensitive", () => {
  expect(contentHash("same")).toBe(contentHash("same"))
  expect(contentHash("same")).not.toBe(contentHash("changed"))
})
