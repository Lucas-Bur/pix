import { describe, expect, it } from "vite-plus/test"

import { buildBm25Index, rankBm25 } from "./bm25.js"

const makeTexts = (...texts: string[]) => texts.map((t, i) => ({ index: i, text: t }))

describe("bm25", () => {
  describe("buildBm25Index", () => {
    it("computes corpus statistics", () => {
      const index = buildBm25Index(
        makeTexts("function handleRequest req", "function handleResponse res", "const x = 1"),
      )
      expect(index.chunkLengths).toEqual([4, 4, 3])
      expect(index.avgChunkLength).toBeCloseTo(3.67, 1)
      expect(index.docFreqs["function"]).toBe(2)
      expect(index.docFreqs["const"]).toBe(1)
      expect(index.chunkTfs["function"]).toHaveLength(2)
    })

    it("handles empty input", () => {
      const index = buildBm25Index([])
      expect(index.chunkLengths).toEqual([])
      expect(index.avgChunkLength).toBe(0)
    })

    it("uses unique-token count for chunk length, not total tokens", () => {
      const index = buildBm25Index(
        makeTexts("return return return function handleRequest", "single chunk"),
      )
      // Chunk 0 tokenises to 6 tokens ("return", "return", "return",
      // "function", "handle", "request") but only 4 are unique.
      // Chunk 1 has 2 unique tokens ("single", "chunk").
      expect(index.chunkLengths).toEqual([4, 2])
      // avgdl is the mean of per-chunk unique-token counts: (4 + 2) / 2 = 3.
      expect(index.avgChunkLength).toBe(3)
    })
  })

  describe("rankBm25", () => {
    it("returns the only chunk when a matching term exists in a single-document corpus", () => {
      const index = buildBm25Index(makeTexts("function handleRequest"))
      const ranks = rankBm25("handleRequest", index)
      expect(ranks).toHaveLength(1)
      expect(ranks[0].chunkIndex).toBe(0)
    })

    it("ranks chunks with exact term match", () => {
      const index = buildBm25Index(
        makeTexts("function handleRequest req", "function handleResponse res", "const x = 1"),
      )
      const ranks = rankBm25("handleRequest", index)
      expect(ranks.length).toBeGreaterThan(0)
      expect(ranks[0].chunkIndex).toBe(0)
    })

    it("returns empty for query with no matching terms", () => {
      const index = buildBm25Index(makeTexts("const x = 1", "const y = 2"))
      const ranks = rankBm25("nonexistent", index)
      expect(ranks).toEqual([])
    })

    it("returns empty for empty query", () => {
      const index = buildBm25Index(makeTexts("some text"))
      expect(rankBm25("", index)).toEqual([])
    })

    it("term appearing in fewer chunks gets higher rank", () => {
      const index = buildBm25Index(makeTexts("unique_term common", "common", "common"))
      const ranks = rankBm25("unique_term", index)
      expect(ranks).toHaveLength(1)
      expect(ranks[0].chunkIndex).toBe(0)
    })

    it("ranks by score descending", () => {
      const index = buildBm25Index(
        makeTexts(
          "unique unique unique",
          "unique",
          "other function",
          "yet another doc",
          "and one more",
        ),
      )
      const ranks = rankBm25("unique", index)
      expect(ranks).toHaveLength(2)
      expect(ranks[0].chunkIndex).toBe(0)
    })
  })
})
