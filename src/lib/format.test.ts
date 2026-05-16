import { expect, test } from "vite-plus/test"

import { applyTokenBudget, countTokens, truncateToTokens } from "./format.js"
import { formatBytes } from "./format.js"

test("formatBytes returns 0 B for zero", () => {
  expect(formatBytes(0)).toBe("0 B")
})

test("formatBytes formats bytes to human-readable string", () => {
  expect(formatBytes(512)).toBe("512.0 B")
  expect(formatBytes(1024)).toBe("1.0 KB")
  expect(formatBytes(1536)).toBe("1.5 KB")
  expect(formatBytes(1048576)).toBe("1.0 MB")
})

test("formatBytes handles GB boundary", () => {
  expect(formatBytes(1073741824)).toBe("1.0 GB")
  expect(formatBytes(1610612736)).toBe("1.5 GB")
})

test("formatBytes caps at GB for values >= 1 TB", () => {
  expect(formatBytes(1099511627776)).toBe("1024.0 GB")
  expect(formatBytes(1e15)).toBe("931322.6 GB")
})

test("countTokens estimates token count roughly", () => {
  expect(countTokens("")).toBe(0)
  expect(countTokens("hello world")).toBeGreaterThan(0)
  expect(countTokens("short")).toBeLessThan(countTokens("a much longer piece of text here"))
})

test("truncateToTokens returns full text when within budget", () => {
  const result = truncateToTokens("hello world", 100)
  expect(result.text).toBe("hello world")
  expect(result.truncated).toBe(false)
})

test("truncateToTokens truncates and appends indicator when over budget", () => {
  const text = "a ".repeat(100)
  const result = truncateToTokens(text, 5)
  expect(result.text).toContain(" [...]")
  expect(result.truncated).toBe(true)
  expect(result.text.length).toBeLessThan(text.length)
})

test("truncateToTokens does not truncate for zero tokens", () => {
  const result = truncateToTokens("hello", 0)
  expect(result.text).toBe("")
  expect(result.truncated).toBe(true)
})

test("applyTokenBudget returns all results when no maxTokens", () => {
  const results = [
    { score: 1, file: "a.ts", startLine: 1, endLine: 1, text: "hello" },
    { score: 0.5, file: "b.ts", startLine: 1, endLine: 1, text: "world" },
  ]
  const applied = applyTokenBudget(results)
  expect(applied.results).toHaveLength(2)
})

test("applyTokenBudget truncates when budget is exceeded", () => {
  const results = [
    { score: 1, file: "a.ts", startLine: 1, endLine: 1, text: "hello world" },
    { score: 0.5, file: "b.ts", startLine: 1, endLine: 1, text: "foo bar baz" },
  ]
  const applied = applyTokenBudget(results, 1)
  expect(applied.results.length).toBeLessThanOrEqual(2)
})
