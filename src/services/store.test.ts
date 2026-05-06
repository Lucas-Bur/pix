import { FileSystem } from "@effect/platform"
import { NodeFileSystem } from "@effect/platform-node"
import { Effect } from "effect"
import { expect, test } from "vite-plus/test"

import { type Config } from "../types.ts"
import { writeConfig, readConfig, configExists, ConfigError } from "./store.ts"

const defaultConfig: Config = {
  schema: "1",
  model: "Xenova/all-MiniLM-L6-v2",
  dims: 384,
  chunkLines: 60,
  overlapLines: 10,
  files: {},
}

const cleanPixDir = (): Effect.Effect<void, never, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    yield* fs.remove(".pix", { recursive: true })
  }).pipe(Effect.catchAll(() => Effect.void))

test("writeConfig creates .pix/config.json with valid config", () =>
  Effect.gen(function* () {
    yield* cleanPixDir()
    yield* writeConfig(defaultConfig)
    const result = yield* readConfig()
    expect(result).toEqual(defaultConfig)
  }).pipe(Effect.provide(NodeFileSystem.layer)))

test("readConfig fails when config doesn't exist", () =>
  Effect.gen(function* () {
    yield* cleanPixDir()

    const result = yield* Effect.either(readConfig())
    expect(result._tag).toBe("Left")
  }).pipe(Effect.provide(NodeFileSystem.layer)))

test("configExists returns false when no config", () =>
  Effect.gen(function* () {
    yield* cleanPixDir()

    const exists = yield* configExists()
    expect(exists).toBe(false)
  }).pipe(Effect.provide(NodeFileSystem.layer)))

test("configExists returns true when config exists", () =>
  Effect.gen(function* () {
    yield* cleanPixDir()
    yield* writeConfig(defaultConfig)
    const exists = yield* configExists()
    expect(exists).toBe(true)
  }).pipe(Effect.provide(NodeFileSystem.layer)))

test("readConfig returns ConfigError when config doesn't exist", () =>
  Effect.gen(function* () {
    yield* cleanPixDir()

    const result = yield* Effect.either(readConfig())
    if (result._tag === "Left") {
      expect(result.left._tag).toBe("ConfigError")
      expect(result.left.message).toBe("Failed to read config")
    } else {
      expect(false).toBe(true)
    }
  }).pipe(Effect.provide(NodeFileSystem.layer)))

test("ConfigError has correct structure", () => {
  const error = new ConfigError({ message: "test", cause: undefined })
  expect(error._tag).toBe("ConfigError")
  expect(error.message).toBe("test")
})
