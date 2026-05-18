import { describe, expect, it } from "vite-plus/test"

import { bm25Weight, denseWeight } from "./query-router.js"

describe("query-router", () => {
  describe("bm25Weight", () => {
    it("boosts short queries", () => {
      expect(bm25Weight("foo")).toBe(1.5)
    })

    it("reduces long queries", () => {
      expect(bm25Weight("this is a very long natural language query")).toBe(0.5)
    })

    it("returns default for medium queries", () => {
      expect(bm25Weight("find user by name")).toBe(1.0)
    })
  })

  describe("denseWeight", () => {
    it("reduces short queries", () => {
      expect(denseWeight("foo")).toBe(0.5)
    })

    it("boosts long queries", () => {
      expect(denseWeight("this is a very long natural language query")).toBe(1.5)
    })

    it("returns default for medium queries", () => {
      expect(denseWeight("find user by name")).toBe(1.0)
    })
  })
})
