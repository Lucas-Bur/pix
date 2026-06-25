import { describe, expect, it } from "vite-plus/test"

/**
 * Regression test: source-level verification of lazy @huggingface/transformers import.
 *
 * Device-detect.ts must NOT have a top-level static import of @huggingface/transformers (e.g.
 * `import { env } from "@huggingface/transformers"`). It must use a dynamic import inside make()
 * instead.
 *
 * This prevents loading the ~22MB transformers library during CLI startup for commands that don't
 * need the embedder (status, reset, init, config).
 */
describe("device-detect lazy import", () => {
  it("has no static @huggingface/transformers import at top level", async () => {
    // Read the source file text and verify no static import pattern exists
    const { readFileSync } = await import("node:fs")
    const { resolve } = await import("node:path")
    const path = resolve(import.meta.dirname ?? __dirname, "device-detect.ts")
    const source = readFileSync(path, "utf-8")

    // Check that there's no top-level static import (before any function/class)
    // Split at the first function/class/const keyword that indicates body start
    const topLevelSection = source.split("\nconst ")[0] ?? ""
    const hasStaticImport = topLevelSection.includes('from "@huggingface/transformers"')
    const hasStaticRequire = topLevelSection.includes('require("@huggingface/transformers")')

    expect(hasStaticImport).toBe(false)
    expect(hasStaticRequire).toBe(false)
  })
})
