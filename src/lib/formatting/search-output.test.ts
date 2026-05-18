import { expect, test } from "vite-plus/test"

import type { SearchResult } from "../../domain/ports.js"
import { applyCharBudget, formatBytes } from "./search-output.js"

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

test("applyCharBudget returns all results when no maxChars", () => {
  const results = [
    {
      score: 1,
      file: "a.ts",
      startLine: 1,
      endLine: 1,
      text: "hello",
      contextBefore: null,
      contextAfter: null,
    },
    {
      score: 0.5,
      file: "b.ts",
      startLine: 1,
      endLine: 1,
      text: "world",
      contextBefore: null,
      contextAfter: null,
    },
  ]
  const applied = applyCharBudget(results)
  expect(applied.results).toHaveLength(2)
})

test("applyCharBudget truncates when budget is exceeded", () => {
  const results = [
    {
      score: 1,
      file: "a.ts",
      startLine: 1,
      endLine: 1,
      text: "hello world",
      contextBefore: null,
      contextAfter: null,
    },
    {
      score: 0.5,
      file: "b.ts",
      startLine: 1,
      endLine: 1,
      text: "foo bar baz",
      contextBefore: null,
      contextAfter: null,
    },
  ]
  const applied = applyCharBudget(results, 18)
  expect(applied.results.length).toBe(1)
  expect(applied.results[0].text).toContain(" [...]")
})

test("applyCharBudget preserves contextBefore and contextAfter when within budget", () => {
  const results: SearchResult[] = [
    {
      score: 1,
      file: "a.ts",
      startLine: 1,
      endLine: 1,
      text: "hi",
      contextBefore: "ctx",
      contextAfter: "more",
    },
  ]
  const applied = applyCharBudget(results, 50)
  expect(applied.results).toHaveLength(1)
  expect(applied.results[0].text).toBe("hi")
})

test("applyCharBudget strips context when truncating", () => {
  const results: SearchResult[] = [
    {
      score: 1,
      file: "a.ts",
      startLine: 1,
      endLine: 1,
      text: "hello world this is long text",
      contextBefore: "ctx",
      contextAfter: "more",
    },
  ]
  const applied = applyCharBudget(results, 25)
  expect(applied.results).toHaveLength(1)
  expect(applied.results[0].contextBefore).toBeNull()
  expect(applied.results[0].contextAfter).toBeNull()
})
