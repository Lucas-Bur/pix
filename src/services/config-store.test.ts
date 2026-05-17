import { Effect, Layer } from "effect"
import { MemoryFileSystem } from "effect-memfs"
import { expect, test } from "vite-plus/test"

const expectLeft = <A>(
  result: { _tag: "Left"; left: A } | { _tag: "Right"; right: unknown },
): A => {
  expect(result._tag).toBe("Left")
  if (result._tag === "Right") throw new Error("Expected Left")
  return result.left
}

import { makeConfigJson } from "../../tests/test-utils/fixtures.js"
import { memoryFsLayer } from "../../tests/test-utils/memfs.js"
import { DEFAULT_CONFIG } from "../domain/config.ts"
import { ConfigStore, ConfigStoreLive } from "./config-store.ts"

const makeLayer = (contents?: MemoryFileSystem.Contents) =>
  Layer.provideMerge(ConfigStoreLive, memoryFsLayer(contents ?? {}))

test("ConfigStore.writeConfig creates .pix/config.json with defaults", () =>
  Effect.gen(function* () {
    const store = yield* ConfigStore
    yield* store.writeConfig(DEFAULT_CONFIG)
    const config = yield* store.readConfig()
    expect(config.schema).toBe("1")
    expect(config.embedder.model).toBe("Xenova/all-MiniLM-L6-v2")
    expect(config.chunkLines).toBe(60)
    expect(config.overlapLines).toBe(10)
    expect(config.skipExtensions).toEqual([])
    expect(config.embedder.batchSize).toBe(16)
    expect(config.ignoredPaths).toEqual([
      ".pix",
      "node_modules",
      ".git",
      "dist",
      "build",
      ".next",
      ".vscode",
      "coverage",
      "*-lock.yaml",
      "*-lock.json",
      "*.lock",
      ".vite-hooks",
      ".fallow",
    ])
  }).pipe(Effect.provide(makeLayer())))

test("ConfigStore.readConfig returns ConfigError when config doesn't exist", () =>
  Effect.gen(function* () {
    const store = yield* ConfigStore
    const result = expectLeft(yield* Effect.either(store.readConfig()))
    expect(result._tag).toBe("ConfigError")
    expect(result.message).toBe("Failed to read config.json")
  }).pipe(Effect.provide(makeLayer())))

test("ConfigStore.configExists returns false when no config", () =>
  Effect.gen(function* () {
    const store = yield* ConfigStore
    const exists = yield* store.configExists()
    expect(exists).toBe(false)
  }).pipe(Effect.provide(makeLayer())))

test("ConfigStore.configExists returns true when config exists", () =>
  Effect.gen(function* () {
    const store = yield* ConfigStore
    yield* store.writeConfig(DEFAULT_CONFIG)
    const exists = yield* store.configExists()
    expect(exists).toBe(true)
  }).pipe(Effect.provide(makeLayer())))

test("readConfig returns ConfigMalformedError for invalid JSON", () =>
  Effect.gen(function* () {
    const store = yield* ConfigStore
    const result = expectLeft(yield* Effect.either(store.readConfig()))
    expect(result._tag).toBe("ConfigMalformedError")
  }).pipe(Effect.provide(makeLayer({ ".pix/config.json": "not json" }))))

test("readConfig returns ConfigValidationError for missing required field", () =>
  Effect.gen(function* () {
    const store = yield* ConfigStore
    const result = expectLeft(yield* Effect.either(store.readConfig()))
    expect(result._tag).toBe("ConfigValidationError")
    expect(result.message).toContain("embedder")
  }).pipe(
    Effect.provide(
      makeLayer({ ".pix/config.json": JSON.stringify({ schema: "1", chunkLines: 60 }) }),
    ),
  ))

const invalidConfig = {
  ...DEFAULT_CONFIG,
  embedder: { ...DEFAULT_CONFIG.embedder, device: "cuda!" },
}

test("readConfig returns ConfigValidationError for invalid enum value", () =>
  Effect.gen(function* () {
    const store = yield* ConfigStore
    const result = expectLeft(yield* Effect.either(store.readConfig()))
    expect(result._tag).toBe("ConfigValidationError")
    expect(result.message).toContain("device")
  }).pipe(
    Effect.provide(
      // Intentionally invalid: device "cuda!" is not in the enum — tests ConfigValidationError path
      makeLayer({ ".pix/config.json": JSON.stringify(invalidConfig) }),
    ),
  ))

test("readConfig passes through a valid config", () =>
  Effect.gen(function* () {
    const store = yield* ConfigStore
    const config = yield* store.readConfig()
    expect(config.schema).toBe("1")
    expect(config.embedder.model).toBe("Xenova/all-MiniLM-L6-v2")
  }).pipe(Effect.provide(makeLayer({ ".pix/config.json": makeConfigJson() }))))
