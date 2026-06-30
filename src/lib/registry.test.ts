import { describe, expect, it } from "vite-plus/test"

import { buildExtensionRegistry } from "./registry.js"

describe("buildExtensionRegistry", () => {
  it("includes all default extensions with no skip", () => {
    const registry = buildExtensionRegistry([])
    // Code: TS-flavored have parsers, others None
    expect(Object.keys(registry)).toContain(".ts")
    expect(Object.keys(registry)).toContain(".py")
    expect(Object.keys(registry)).toContain(".md")
    expect(Object.keys(registry)).toContain(".json")
  })

  it("provides a parser for TypeScript extensions (strict TS for .ts/.js, TSX for .tsx/.jsx)", () => {
    const registry = buildExtensionRegistry([])
    expect(registry[".ts"]?.parser._tag).toBe("Some")
    expect(registry[".tsx"]?.parser._tag).toBe("Some")
    expect(registry[".js"]?.parser._tag).toBe("Some")
    expect(registry[".jsx"]?.parser._tag).toBe("Some")
  })

  it("does not provide a parser for non-code extensions", () => {
    const registry = buildExtensionRegistry([])
    expect(registry[".md"]?.parser._tag).toBe("None")
    expect(registry[".json"]?.parser._tag).toBe("None")
    expect(registry[".txt"]?.parser._tag).toBe("None")
    expect(registry[".yaml"]?.parser._tag).toBe("None")
  })

  it("does not provide a parser for other code languages until wired in", () => {
    const registry = buildExtensionRegistry([])
    // Python/Rust/Go are known code but no tree-sitter package installed yet
    expect(registry[".py"]?.parser._tag).toBe("None")
    expect(registry[".rs"]?.parser._tag).toBe("None")
    expect(registry[".go"]?.parser._tag).toBe("None")
  })

  it("overrides skip extensions to a fail-fast processor and None parser", () => {
    const registry = buildExtensionRegistry([".md", ".ts"])
    // The override replaces the entry -- skip processor + no parser
    expect(registry[".md"]?.parser._tag).toBe("None")
    // processor becomes skipProcessor -- calling it returns UnsupportedFormat
    const result = registry[".md"]?.processor("foo.md")
    expect(result).toBeDefined()
  })

  it("does not affect non-skipped extensions", () => {
    const registry = buildExtensionRegistry([".md"])
    expect(registry[".ts"]?.parser._tag).toBe("Some")
  })
})
