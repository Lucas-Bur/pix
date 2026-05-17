import { describe, expect, it } from "vite-plus/test"

import { makeIgnoreFilter, makeOnlyFilter } from "./path-filter.js"

describe("makeIgnoreFilter", () => {
  it("returns null for empty patterns", () => {
    expect(makeIgnoreFilter([])).toBeNull()
  })

  it("ignores matching paths", () => {
    const filter = makeIgnoreFilter(["*.log"])
    expect(filter).not.toBeNull()
    expect(filter!.ignores("debug.log")).toBe(true)
  })

  it("passes non-matching paths", () => {
    const filter = makeIgnoreFilter(["*.log"])
    expect(filter!.ignores("src/index.ts")).toBe(false)
  })

  it("handles directory patterns", () => {
    const filter = makeIgnoreFilter(["node_modules/"])
    expect(filter!.ignores("node_modules/foo/bar.js")).toBe(true)
    expect(filter!.ignores("src/index.ts")).toBe(false)
  })
})

describe("makeOnlyFilter", () => {
  it("returns null for empty patterns", () => {
    expect(makeOnlyFilter([])).toBeNull()
  })

  it("includes matching paths", () => {
    const filter = makeOnlyFilter(["*.ts"])
    expect(filter).not.toBeNull()
    expect(filter!.ignores("src/index.ts")).toBe(true)
  })

  it("excludes non-matching paths", () => {
    const filter = makeOnlyFilter(["*.ts"])
    expect(filter!.ignores("debug.log")).toBe(false)
  })
})
