import { expect, test } from "vite-plus/test"

import { formatError } from "./error-format.js"

test("formatError handles string errors", () => {
  const result = JSON.parse(formatError("something broke"))
  expect(result.error).toBe(true)
  expect(result.code).toBe("UNKNOWN")
  expect(result.message).toBe("something broke")
})

test("formatError handles object with message property", () => {
  const result = JSON.parse(formatError({ message: "disk full" }))
  expect(result.error).toBe(true)
  expect(result.message).toBe("disk full")
})

test("formatError handles null / unknown error", () => {
  const result = JSON.parse(formatError(null))
  expect(result.error).toBe(true)
  expect(result.code).toBe("UNKNOWN")
  expect(result.message).toBe("Unknown error")
})

test("formatError maps ConfigError _tag to CONFIG_MISSING code", () => {
  const result = JSON.parse(formatError({ _tag: "ConfigError", message: "config missing" }))
  expect(result.error).toBe(true)
  expect(result.code).toBe("CONFIG_MISSING")
  expect(result.message).toBe("config missing")
})

test("formatError maps PlatformError _tag to PLATFORM_ERROR code", () => {
  const result = JSON.parse(formatError({ _tag: "PlatformError", message: "io error" }))
  expect(result.error).toBe(true)
  expect(result.code).toBe("PLATFORM_ERROR")
  expect(result.message).toBe("io error")
})

test("formatError returns UNKNOWN for unrecognized _tag", () => {
  const result = JSON.parse(formatError({ _tag: "SomeWeirdError", message: "odd" }))
  expect(result.error).toBe(true)
  expect(result.code).toBe("UNKNOWN")
  expect(result.message).toBe("odd")
})

test("formatError returns code UNKNOWN when no _tag present", () => {
  const result = JSON.parse(formatError({ name: "Error" }))
  expect(result.error).toBe(true)
  expect(result.code).toBe("UNKNOWN")
  expect(result.message).toBe("Unknown error")
})

test("formatError handles undefined", () => {
  const result = JSON.parse(formatError(undefined))
  expect(result.error).toBe(true)
  expect(result.code).toBe("UNKNOWN")
  expect(result.message).toBe("Unknown error")
})

test("formatError handles empty object", () => {
  const result = JSON.parse(formatError({}))
  expect(result.error).toBe(true)
  expect(result.code).toBe("UNKNOWN")
  expect(result.message).toBe("Unknown error")
})

test("formatError coerces non-string _tag to string", () => {
  const result = JSON.parse(formatError({ _tag: 404, message: "not found" }))
  expect(result.error).toBe(true)
  expect(result.code).toBe("UNKNOWN")
  expect(result.message).toBe("not found")
})
