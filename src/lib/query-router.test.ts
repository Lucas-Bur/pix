import { describe, expect, it } from "vite-plus/test"

import { routeQuery } from "./query-router.js"

describe("routeQuery", () => {
  it("boosts BM25 for short queries", () => {
    const w = routeQuery("foo bar")
    expect(w.bm25).toBe(1.5)
    expect(w.dense).toBe(0.5)
  })

  it("boosts dense for long queries", () => {
    const w = routeQuery("this is a very long natural language query with many tokens")
    expect(w.bm25).toBe(0.5)
    expect(w.dense).toBe(1.5)
  })

  it("returns equal weights for medium queries", () => {
    const w = routeQuery("find user by name")
    expect(w.bm25).toBe(1.0)
    expect(w.dense).toBe(1.0)
  })

  it("weights always sum to 2", () => {
    const cases = ["a", "foo bar", "one two three", "a b c d e f g h"]
    for (const q of cases) {
      const w = routeQuery(q)
      expect(w.bm25 + w.dense).toBeCloseTo(2, 10)
    }
  })
})
