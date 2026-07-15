import { expect, test } from "@effect/vitest"

import { isPlatformReason } from "./platform-error.js"

test("isPlatformReason returns true when cause has matching reason", () => {
  expect(isPlatformReason({ reason: "BadResource" }, "BadResource")).toBe(true)
  expect(isPlatformReason({ reason: "NotFound" }, "NotFound")).toBe(true)
})

test("isPlatformReason returns false when cause has different reason", () => {
  expect(isPlatformReason({ reason: "BadResource" }, "NotFound")).toBe(false)
})

test("isPlatformReason returns false for null", () => {
  expect(isPlatformReason(null, "BadResource")).toBe(false)
})

test("isPlatformReason returns false for primitive values", () => {
  expect(isPlatformReason("string", "BadResource")).toBe(false)
  expect(isPlatformReason(42, "BadResource")).toBe(false)
  expect(isPlatformReason(undefined, "BadResource")).toBe(false)
})

test("isPlatformReason returns false when cause lacks reason property", () => {
  expect(isPlatformReason({ message: "error" }, "BadResource")).toBe(false)
})

test("isPlatformReason coerces reason to string", () => {
  expect(isPlatformReason({ reason: 123 }, "123")).toBe(true)
})
