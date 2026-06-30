import { Effect, Layer } from "effect"
import { FileSystem } from "effect/FileSystem"
import { describe, expect, it } from "vite-plus/test"

import { buildExtensionRegistry } from "./registry.js"

/**
 * Stub FileSystem layer. The skip processor never reads the FS, so any implementation suffices --
 * we just need the service in scope for the type check.
 */
const noopFileSystemLayer = Layer.succeed(FileSystem, {} as never)

describe("buildExtensionRegistry", () => {
  it("includes all default extensions with no skip", () => {
    const registry = buildExtensionRegistry([])
    // Code: TS-flavored have parsers, others null
    expect(Object.keys(registry)).toContain(".ts")
    expect(Object.keys(registry)).toContain(".py")
    expect(Object.keys(registry)).toContain(".md")
    expect(Object.keys(registry)).toContain(".json")
  })

  it("provides a parser for TypeScript extensions (strict TS for .ts/.js, TSX for .tsx/.jsx)", () => {
    const registry = buildExtensionRegistry([])
    expect(registry[".ts"]?.parser).not.toBeNull()
    expect(registry[".tsx"]?.parser).not.toBeNull()
    expect(registry[".js"]?.parser).not.toBeNull()
    expect(registry[".jsx"]?.parser).not.toBeNull()
  })

  it("does not provide a parser for non-code extensions", () => {
    const registry = buildExtensionRegistry([])
    expect(registry[".md"]?.parser).toBeNull()
    expect(registry[".json"]?.parser).toBeNull()
    expect(registry[".txt"]?.parser).toBeNull()
    expect(registry[".yaml"]?.parser).toBeNull()
  })

  it("does not provide a parser for other code languages until wired in", () => {
    const registry = buildExtensionRegistry([])
    // Python/Rust/Go are known code but no tree-sitter package installed yet
    expect(registry[".py"]?.parser).toBeNull()
    expect(registry[".rs"]?.parser).toBeNull()
    expect(registry[".go"]?.parser).toBeNull()
  })

  it("overrides skip extensions to a fail-fast processor and null parser", () => {
    const registry = buildExtensionRegistry([".md", ".ts"])
    // The override replaces the entry -- skip processor + null parser
    expect(registry[".md"]?.parser).toBeNull()
    // processor becomes skipProcessor -- calling it must fail with UnsupportedFormat.
    // The skip effect is synchronous; provide a stub FileSystem so the type
    // check passes (the FS is never read at runtime).
    const program = Effect.flip(registry[".md"]!.processor("foo.md"))
    const error = Effect.runSync(Effect.provide(program, noopFileSystemLayer))
    expect(error._tag).toBe("UnsupportedFormat")
    if (error._tag === "UnsupportedFormat") {
      expect(error.extension).toBe(".md")
    }
  })

  it("does not affect non-skipped extensions", () => {
    const registry = buildExtensionRegistry([".md"])
    expect(registry[".ts"]?.parser).not.toBeNull()
  })
})
