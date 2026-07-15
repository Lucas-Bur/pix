import { describe, expect, it } from "@effect/vitest"

import type { SearchResult } from "../domain/ports.js"
import { filterResults } from "./query-project.js"

const makeResult = (file: string): SearchResult => ({
  score: 1,
  rel: 0.98,
  file,
  startLine: 1,
  endLine: 1,
  text: "x",
  contextBefore: null,
  contextAfter: null,
})

describe("filterResults", () => {
  it("returns all results when no filters", () => {
    const results = [makeResult("a.ts"), makeResult("b.ts")]
    expect(filterResults(results, undefined)).toHaveLength(2)
  })

  it("excludes ignorePaths matches", () => {
    const results = [makeResult("src/a.ts"), makeResult("test/a.test.ts")]
    const filtered = filterResults(results, { ignorePaths: ["**/*.test.ts"] })
    expect(filtered).toHaveLength(1)
    expect(filtered[0].file).toBe("src/a.ts")
  })

  it("restricts to onlyPaths matches", () => {
    const results = [makeResult("src/a.ts"), makeResult("lib/b.ts")]
    const filtered = filterResults(results, { onlyPaths: ["src/**"] })
    expect(filtered).toHaveLength(1)
    expect(filtered[0].file).toBe("src/a.ts")
  })

  it("applies both ignorePaths and onlyPaths", () => {
    const results = [makeResult("src/a.ts"), makeResult("src/b.test.ts"), makeResult("lib/c.ts")]
    const filtered = filterResults(results, {
      onlyPaths: ["src/**"],
      ignorePaths: ["**/*.test.ts"],
    })
    expect(filtered).toHaveLength(1)
    expect(filtered[0].file).toBe("src/a.ts")
  })
})
