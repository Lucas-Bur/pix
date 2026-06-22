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
import { ModelRegistryLive } from "./models.ts"

const makeLayer = (contents?: MemoryFileSystem.Contents) =>
  Layer.provideMerge(
    Layer.provideMerge(ConfigStoreLive, memoryFsLayer(contents ?? {})),
    ModelRegistryLive,
  )

test("ConfigStore.writeConfig creates .pix/config.json with defaults", () =>
  Effect.gen(function* () {
    const store = yield* ConfigStore
    yield* store.writeConfig(DEFAULT_CONFIG)
    const config = yield* store.readConfig()
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

test("readConfig heals missing embedder with defaults (was validation error pre-heal)", () =>
  Effect.gen(function* () {
    const store = yield* ConfigStore
    const config = yield* store.readConfig()
    expect(config.embedder.model).toBe("Xenova/all-MiniLM-L6-v2")
    expect(config.chunkLines).toBe(60)
  }).pipe(Effect.provide(makeLayer({ ".pix/config.json": JSON.stringify({ chunkLines: 60 }) }))))

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
    expect(config.embedder.model).toBe("Xenova/all-MiniLM-L6-v2")
  }).pipe(Effect.provide(makeLayer({ ".pix/config.json": makeConfigJson() }))))

test("readConfig heals missing embedder key with defaults", () =>
  Effect.gen(function* () {
    const store = yield* ConfigStore
    const config = yield* store.readConfig()
    expect(config.embedder.model).toBe("Xenova/all-MiniLM-L6-v2")
    expect(config.embedder.device).toBe("auto")
    expect(config.embedder.dtype).toBe("fp32")
    expect(config.embedder.batchSize).toBe(16)
  }).pipe(
    Effect.provide(
      makeLayer({ ".pix/config.json": JSON.stringify({ chunkLines: 60, overlapLines: 10 }) }),
    ),
  ))

test("readConfig heals partial embedder with defaults", () =>
  Effect.gen(function* () {
    const store = yield* ConfigStore
    const config = yield* store.readConfig()
    expect(config.embedder.model).toBe("Xenova/bge-small-en-v1.5")
    expect(config.embedder.device).toBe("auto")
    expect(config.embedder.dtype).toBe("fp32")
    expect(config.embedder.batchSize).toBe(16)
  }).pipe(
    Effect.provide(
      makeLayer({
        ".pix/config.json": JSON.stringify({
          embedder: { model: "Xenova/bge-small-en-v1.5" },
        }),
      }),
    ),
  ))

test("readConfig still fails on bad type (not healable)", () =>
  Effect.gen(function* () {
    const store = yield* ConfigStore
    const result = expectLeft(yield* Effect.either(store.readConfig()))
    expect(result._tag).toBe("ConfigValidationError")
  }).pipe(
    Effect.provide(makeLayer({ ".pix/config.json": JSON.stringify({ chunkLines: "sixty" }) })),
  ))

test("readConfig heals unsupported dtype with model defaultDtype", () =>
  Effect.gen(function* () {
    const store = yield* ConfigStore
    const config = yield* store.readConfig()
    expect(config.embedder.dtype).toBe("fp32")
    expect(config.embedder.model).toBe("Xenova/all-MiniLM-L6-v2")
  }).pipe(
    Effect.provide(
      makeLayer({
        ".pix/config.json": makeConfigJson({ embedder: { dtype: "q4" } }),
      }),
    ),
  ))

test("readConfigWithConflicts returns healed dtype as a conflict", () =>
  Effect.gen(function* () {
    const store = yield* ConfigStore
    const result = yield* store.readConfigWithConflicts()
    expect(result.config.embedder.dtype).toBe("fp32")
    expect(result.conflicts).toHaveLength(1)
    expect(result.conflicts[0].field).toBe("embedder.dtype")
    expect(result.conflicts[0].currentValue).toBe("q4")
    expect(result.conflicts[0].healed).toBe(true)
    expect(result.conflicts[0].healedValue).toBe("fp32")
  }).pipe(
    Effect.provide(
      makeLayer({
        ".pix/config.json": makeConfigJson({ embedder: { dtype: "q4" } }),
      }),
    ),
  ))

test("readConfig fails with ConfigHealError on unknown model", () =>
  Effect.gen(function* () {
    const store = yield* ConfigStore
    const result = expectLeft(yield* Effect.either(store.readConfig()))
    expect(result._tag).toBe("ConfigHealError")
    if (result._tag === "ConfigHealError") {
      expect(result.conflicts).toHaveLength(1)
      expect(result.conflicts[0].field).toBe("embedder.model")
      expect(result.conflicts[0].currentValue).toBe("foo/bar")
      expect(result.conflicts[0].validOptions).toContain("Xenova/all-MiniLM-L6-v2")
    }
  }).pipe(
    Effect.provide(
      makeLayer({
        ".pix/config.json": makeConfigJson({ embedder: { model: "foo/bar" } }),
      }),
    ),
  ))

test("healConfig returns plan with unhealed conflict for unknown model", () =>
  Effect.gen(function* () {
    const store = yield* ConfigStore
    const plan = yield* store.healConfig()
    expect(plan.conflicts).toHaveLength(1)
    expect(plan.conflicts[0].field).toBe("embedder.model")
    expect(plan.conflicts[0].healed).toBe(false)
    expect(plan.conflicts[0].validOptions).toContain("Xenova/all-MiniLM-L6-v2")
  }).pipe(
    Effect.provide(
      makeLayer({
        ".pix/config.json": makeConfigJson({ embedder: { model: "foo/bar" } }),
      }),
    ),
  ))

test("healConfig returns plan with healed conflict for unsupported dtype", () =>
  Effect.gen(function* () {
    const store = yield* ConfigStore
    const plan = yield* store.healConfig()
    expect(plan.conflicts).toHaveLength(1)
    expect(plan.conflicts[0].field).toBe("embedder.dtype")
    expect(plan.conflicts[0].healed).toBe(true)
    expect(plan.conflicts[0].healedValue).toBe("fp32")
    expect(plan.config.embedder.dtype).toBe("fp32")
  }).pipe(
    Effect.provide(
      makeLayer({
        ".pix/config.json": makeConfigJson({ embedder: { dtype: "q4" } }),
      }),
    ),
  ))

test("healConfig returns empty conflicts for valid config", () =>
  Effect.gen(function* () {
    const store = yield* ConfigStore
    const plan = yield* store.healConfig()
    expect(plan.conflicts).toHaveLength(0)
    expect(plan.config.embedder.model).toBe("Xenova/all-MiniLM-L6-v2")
  }).pipe(Effect.provide(makeLayer({ ".pix/config.json": makeConfigJson() }))))
