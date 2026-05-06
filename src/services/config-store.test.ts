import { Effect } from "effect"
import { expect, test } from "vite-plus/test"

import { DEFAULT_CONFIG } from "../domain/config.ts"
import { ConfigStore, ConfigStoreLive } from "./config-store.ts"

const testLayer = ConfigStoreLive

test("ConfigStore.writeConfig creates .pix/config.json with defaults", () =>
  Effect.gen(function* () {
    const store = yield* ConfigStore
    yield* store.writeConfig(DEFAULT_CONFIG)
    const config = yield* store.readConfig()
    expect(config.schema).toBe("1")
    expect(config.model).toBe("Xenova/all-MiniLM-L6-v2")
    expect(config.dims).toBe(384)
    expect(config.chunkLines).toBe(60)
    expect(config.overlapLines).toBe(10)
    expect(config.files).toEqual({})
  }).pipe(Effect.provide(testLayer)))

test("ConfigStore.readConfig fails when config doesn't exist", () =>
  Effect.gen(function* () {
    const store = yield* ConfigStore
    const result = yield* Effect.either(store.readConfig())
    expect(result._tag).toBe("Left")
  }).pipe(Effect.provide(testLayer)))

test("ConfigStore.configExists returns false when no config", () =>
  Effect.gen(function* () {
    const store = yield* ConfigStore
    const exists = yield* store.configExists()
    expect(exists).toBe(false)
  }).pipe(Effect.provide(testLayer)))

test("ConfigStore.configExists returns true when config exists", () =>
  Effect.gen(function* () {
    const store = yield* ConfigStore
    yield* store.writeConfig(DEFAULT_CONFIG)
    const exists = yield* store.configExists()
    expect(exists).toBe(true)
  }).pipe(Effect.provide(testLayer)))

test("ConfigStore.readConfig returns ConfigError when config doesn't exist", () =>
  Effect.gen(function* () {
    const store = yield* ConfigStore
    const result = yield* Effect.either(store.readConfig())
    if (result._tag === "Left") {
      expect(result.left._tag).toBe("ConfigError")
      expect(result.left.message).toBe("Failed to read config.json")
    } else {
      expect(false).toBe(true)
    }
  }).pipe(Effect.provide(testLayer)))
