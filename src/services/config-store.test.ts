import { expect, it } from "@effect/vitest"
import type { FileTree } from "@lucas-bur/effect-memfs"
import { Effect, Layer, Result } from "effect"

const expectLeft = <A>(result: Result.Result<unknown, A>): A => {
  expect(Result.isFailure(result)).toBe(true)
  if (Result.isSuccess(result)) throw new Error("Expected Failure")
  return result.failure
}
import { makeConfigJson } from "../../tests/test-utils/fixtures.js"
import { memoryFsLayer } from "../../tests/test-utils/memfs.js"
import { DEFAULT_CONFIG } from "../domain/config.js"
import { ConfigStore } from "../domain/ports.js"
import { ConfigStoreLive } from "./config-store.js"
import { ModelRegistryLive } from "./models.js"

const makeLayer = (contents?: FileTree) =>
  Layer.provideMerge(
    Layer.provideMerge(ConfigStoreLive, memoryFsLayer(contents ?? {})),
    ModelRegistryLive,
  )

it.effect("ConfigStore.writeConfig creates .pix/config.json with defaults", () =>
  Effect.gen(function* () {
    const store = yield* ConfigStore
    yield* store.writeConfig(DEFAULT_CONFIG)
    const config = yield* store.readConfig
    expect(config.embedder.model).toBe("Xenova/all-MiniLM-L6-v2")
    expect(config.chunkTokens).toBeUndefined()
    expect(config.overlapLines).toBe(10)
    expect(config.skipExtensions).toEqual([])
    expect(config.embedder.batchSize).toBe(16)
    expect(config.sparseEmbedder.model).toBe(
      "raul3820/opensearch-neural-sparse-encoding-doc-v3-distill-onnx",
    )
    expect(config.sparseEmbedder.batchSize).toBe(2)
    expect(config.sparseEmbedder.device).toBe("auto")
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
  }).pipe(Effect.provide(makeLayer())),
)

it.effect("ConfigStore.readConfig returns ConfigError when config doesn't exist", () =>
  Effect.gen(function* () {
    const store = yield* ConfigStore
    const result = expectLeft(yield* Effect.result(store.readConfig))
    expect(result._tag).toBe("ConfigError")
    expect(result.message).toBe("Failed to read config.json")
  }).pipe(Effect.provide(makeLayer())),
)

it.effect("ConfigStore.configExists returns false when no config", () =>
  Effect.gen(function* () {
    const store = yield* ConfigStore
    const exists = yield* store.configExists
    expect(exists).toBe(false)
  }).pipe(Effect.provide(makeLayer())),
)

it.effect("ConfigStore.configExists returns true when config exists", () =>
  Effect.gen(function* () {
    const store = yield* ConfigStore
    yield* store.writeConfig(DEFAULT_CONFIG)
    const exists = yield* store.configExists
    expect(exists).toBe(true)
  }).pipe(Effect.provide(makeLayer())),
)

it.effect("readConfig returns ConfigMalformedError for invalid JSON", () =>
  Effect.gen(function* () {
    const store = yield* ConfigStore
    const result = expectLeft(yield* Effect.result(store.readConfig))
    expect(result._tag).toBe("ConfigMalformedError")
  }).pipe(Effect.provide(makeLayer({ ".pix/config.json": "not json" }))),
)

it.effect("readConfig heals missing embedder with defaults (was validation error pre-heal)", () =>
  Effect.gen(function* () {
    const store = yield* ConfigStore
    const config = yield* store.readConfig
    expect(config.embedder.model).toBe("Xenova/all-MiniLM-L6-v2")
    expect(config.chunkTokens).toBe(2000)
  }).pipe(Effect.provide(makeLayer({ ".pix/config.json": JSON.stringify({ chunkTokens: 2000 }) }))),
)

const invalidConfig = {
  ...DEFAULT_CONFIG,
  embedder: { ...DEFAULT_CONFIG.embedder, device: "cuda!" },
}

it.effect("readConfig returns ConfigValidationError for invalid enum value", () =>
  Effect.gen(function* () {
    const store = yield* ConfigStore
    const result = expectLeft(yield* Effect.result(store.readConfig))
    expect(result._tag).toBe("ConfigValidationError")
    expect(result.message).toContain("device")
  }).pipe(
    Effect.provide(
      // Intentionally invalid: device "cuda!" is not in the enum — tests ConfigValidationError path
      makeLayer({ ".pix/config.json": JSON.stringify(invalidConfig) }),
    ),
  ),
)

it.effect("readConfig rejects a non-positive sparse batch size", () =>
  Effect.gen(function* () {
    const result = expectLeft(yield* Effect.result((yield* ConfigStore).readConfig))
    expect(result._tag).toBe("ConfigValidationError")
    expect(result.message).toContain('["sparseEmbedder"]["batchSize"]')
  }).pipe(
    Effect.provide(
      makeLayer({
        ".pix/config.json": JSON.stringify({
          ...DEFAULT_CONFIG,
          sparseEmbedder: { ...DEFAULT_CONFIG.sparseEmbedder, batchSize: 0 },
        }),
      }),
    ),
  ),
)

it.effect("readConfig passes through a valid config", () =>
  Effect.gen(function* () {
    const store = yield* ConfigStore
    const config = yield* store.readConfig
    expect(config.embedder.model).toBe("Xenova/all-MiniLM-L6-v2")
  }).pipe(Effect.provide(makeLayer({ ".pix/config.json": makeConfigJson() }))),
)

it.effect("readConfig heals missing embedder key with defaults", () =>
  Effect.gen(function* () {
    const store = yield* ConfigStore
    const config = yield* store.readConfig
    expect(config.embedder.model).toBe("Xenova/all-MiniLM-L6-v2")
    expect(config.embedder.device).toBe("auto")
    expect(config.embedder.dtype).toBe("fp32")
    expect(config.embedder.batchSize).toBe(16)
  }).pipe(
    Effect.provide(
      makeLayer({ ".pix/config.json": JSON.stringify({ chunkTokens: 60, overlapLines: 10 }) }),
    ),
  ),
)

it.effect("readConfig heals partial embedder with defaults", () =>
  Effect.gen(function* () {
    const store = yield* ConfigStore
    const config = yield* store.readConfig
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
  ),
)

it.effect("readConfig still fails on bad type (not healable)", () =>
  Effect.gen(function* () {
    const store = yield* ConfigStore
    const result = expectLeft(yield* Effect.result(store.readConfig))
    expect(result._tag).toBe("ConfigValidationError")
  }).pipe(
    Effect.provide(makeLayer({ ".pix/config.json": JSON.stringify({ chunkTokens: "sixty" }) })),
  ),
)

it.effect("readConfig heals unsupported dtype with model defaultDtype", () =>
  Effect.gen(function* () {
    const store = yield* ConfigStore
    const config = yield* store.readConfig
    expect(config.embedder.dtype).toBe("fp32")
    expect(config.embedder.model).toBe("Xenova/all-MiniLM-L6-v2")
  }).pipe(
    Effect.provide(
      makeLayer({
        ".pix/config.json": makeConfigJson({ embedder: { dtype: "q4" } }),
      }),
    ),
  ),
)

it.effect("healConfig returns healed dtype as a conflict", () =>
  Effect.gen(function* () {
    const store = yield* ConfigStore
    const result = yield* store.healConfig
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
  ),
)

it.effect("readConfig fails with ConfigHealError on unknown model", () =>
  Effect.gen(function* () {
    const store = yield* ConfigStore
    const result = expectLeft(yield* Effect.result(store.readConfig))
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
  ),
)

it.effect("healConfig returns plan with unhealed conflict for unknown model", () =>
  Effect.gen(function* () {
    const store = yield* ConfigStore
    const plan = yield* store.healConfig
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
  ),
)

it.effect("healConfig returns plan with healed conflict for unsupported dtype", () =>
  Effect.gen(function* () {
    const store = yield* ConfigStore
    const plan = yield* store.healConfig
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
  ),
)

it.effect("healConfig returns empty conflicts for valid config", () =>
  Effect.gen(function* () {
    const store = yield* ConfigStore
    const plan = yield* store.healConfig
    expect(plan.conflicts).toHaveLength(0)
    expect(plan.config.embedder.model).toBe("Xenova/all-MiniLM-L6-v2")
  }).pipe(Effect.provide(makeLayer({ ".pix/config.json": makeConfigJson() }))),
)
