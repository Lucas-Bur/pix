import { Effect, Layer } from "effect"
import { MemoryFileSystem } from "effect-memfs"
import { expect, test } from "vite-plus/test"

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
    expect(config.ignoredPaths).toEqual([
      ".agents",
      ".claude",
      ".vscode",
      ".github",
      "coverage",
      "*-lock.yaml",
      "*-lock.json",
      "*.lock",
    ])
  }).pipe(Effect.provide(makeLayer())))

test("ConfigStore.readConfig returns ConfigError when config doesn't exist", () =>
  Effect.gen(function* () {
    const store = yield* ConfigStore
    const result = yield* Effect.either(store.readConfig())
    expect(result._tag).toBe("Left")
    if (result._tag === "Left") {
      expect(result.left._tag).toBe("ConfigError")
      expect(result.left.message).toBe("Failed to read config.json")
    }
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
