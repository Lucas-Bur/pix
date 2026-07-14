import { expect, test } from "vite-plus/test"

import { contentHash } from "./content-hash.js"

test("contentHash is stable and content-sensitive", () => {
  expect(contentHash("same")).toBe(contentHash("same"))
  expect(contentHash("same")).not.toBe(contentHash("changed"))
})
