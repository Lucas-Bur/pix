import { expect, test } from "vite-plus/test"

import { formatError } from "./error-format.js"

const expectError = (
  result: ReturnType<typeof formatError>,
  expected: { code: string; message?: string },
) => {
  expect(result.error).toBe(true)
  expect(result.code).toBe(expected.code)
  if (expected.message !== undefined) {
    expect(result.message).toBe(expected.message)
  }
}

test("formatError handles string errors", () => {
  const result = formatError("something broke")
  expectError(result, { code: "STRING_ERROR", message: "something broke" })
})

test("formatError handles object with message property", () => {
  const result = formatError({ message: "disk full" })
  expect(result.error).toBe(true)
  expect(result.message).toBe("disk full")
})

test("formatError handles null / unknown error", () => {
  const result = formatError(null)
  expectError(result, { code: "UNKNOWN", message: "Unknown error" })
})

test("formatError maps ConfigError _tag to CONFIG_ERROR code", () => {
  const result = formatError({ _tag: "ConfigError", message: "config missing" })
  expectError(result, { code: "CONFIG_ERROR", message: "config missing" })
})

test("formatError maps new error tags correctly", () => {
  expect(formatError({ _tag: "ConfigNotFoundError", message: "not found" }).code).toBe(
    "CONFIG_NOT_FOUND",
  )
  expect(formatError({ _tag: "ConfigMalformedError", message: "bad json" }).code).toBe(
    "CONFIG_MALFORMED",
  )
  expect(formatError({ _tag: "NoIndexError", message: "no index" }).code).toBe("NO_INDEX")
  expect(formatError({ _tag: "DiskFullError", message: "full" }).code).toBe("DISK_FULL")
  expect(formatError({ _tag: "StoreError", message: "io" }).code).toBe("STORE_ERROR")
  expect(formatError({ _tag: "ChunkerError", message: "chunk" }).code).toBe("CHUNK_ERROR")
  expect(formatError({ _tag: "ModelLoadError", message: "load" }).code).toBe("MODEL_LOAD_ERROR")
  expect(formatError({ _tag: "InferenceError", message: "infer" }).code).toBe("INFERENCE_ERROR")
})

test("formatError returns UNKNOWN for unrecognized _tag", () => {
  const result = formatError({ _tag: "SomeWeirdError", message: "odd" })
  expectError(result, { code: "UNKNOWN", message: "odd" })
})

test("formatError returns code UNKNOWN when no _tag present", () => {
  const result = formatError({ name: "Error" })
  expectError(result, { code: "UNKNOWN", message: "Unknown error" })
})

test("formatError handles undefined", () => {
  const result = formatError(undefined)
  expectError(result, { code: "UNKNOWN", message: "Unknown error" })
})

test("formatError handles empty object", () => {
  const result = formatError({})
  expectError(result, { code: "UNKNOWN", message: "Unknown error" })
})

test("formatError coerces non-string _tag to string", () => {
  const result = formatError({ _tag: 404, message: "not found" })
  expectError(result, { code: "UNKNOWN", message: "not found" })
})

test("formatError maps DisplayLogError to DISPLAY_LOG_ERROR", () => {
  const result = formatError({ _tag: "DisplayLogError", message: "log failed" })
  expect(result.code).toBe("DISPLAY_LOG_ERROR")
})

test("formatError maps UnsupportedFormat to UNSUPPORTED_FORMAT", () => {
  const result = formatError({ _tag: "UnsupportedFormat", message: "bad format" })
  expect(result.code).toBe("UNSUPPORTED_FORMAT")
})

test("formatError maps ExtractionFailed to EXTRACTION_FAILED", () => {
  const result = formatError({ _tag: "ExtractionFailed", message: "extract failed" })
  expect(result.code).toBe("EXTRACTION_FAILED")
})

test("formatError extracts model context field", () => {
  const result = formatError({ _tag: "InferenceError", message: "failed", model: "llama-3" })
  expect(result.code).toBe("INFERENCE_ERROR")
  expect(result.model).toBe("llama-3")
})

test("formatError extracts file context field", () => {
  const result = formatError({ _tag: "StoreError", message: "read failed", file: "data.bin" })
  expect(result.file).toBe("data.bin")
})

test("formatError extracts path context field", () => {
  const result = formatError({
    _tag: "ConfigNotFoundError",
    message: "missing",
    path: "/pix.toml",
  })
  expect(result.path).toBe("/pix.toml")
})

test("formatError extracts stack context field", () => {
  const result = formatError({ _tag: "StoreError", message: "crash", stack: "at line 42" })
  expect(result.stack).toBe("at line 42")
})

test("formatError extracts multiple context fields", () => {
  const result = formatError({
    _tag: "InferenceError",
    message: "failed",
    model: "llama-3",
    file: "vectors.bin",
  })
  expect(result.model).toBe("llama-3")
  expect(result.file).toBe("vectors.bin")
})
