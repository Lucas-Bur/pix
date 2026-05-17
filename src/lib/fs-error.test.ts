import { FileSystem } from "@effect/platform"
import { Effect } from "effect"
import { MemoryFileSystem } from "effect-memfs"
import { expect, test } from "vite-plus/test"

import { ensureDirExists, withFsError, withReadError, withConfigError } from "./fs-error.js"

const memFsLayer = (contents?: MemoryFileSystem.Contents) =>
  MemoryFileSystem.layerWith(contents ?? {})

test("withFsError maps BadResource to DiskFullError", () =>
  Effect.gen(function* () {
    const result = yield* Effect.either(
      withFsError(Effect.fail({ reason: "BadResource", message: "disk full" }), "write", "/test"),
    )
    expect(result._tag).toBe("Left")
    if (result._tag === "Left") {
      expect(result.left._tag).toBe("DiskFullError")
      expect(result.left.message).toContain("Disk full during write")
      expect(result.left.path).toBe("/test")
    }
  }).pipe(Effect.provide(memFsLayer())))

test("withFsError maps other errors to StoreError", () =>
  Effect.gen(function* () {
    const result = yield* Effect.either(
      withFsError(Effect.fail({ reason: "Unknown", message: "oops" }), "read", "/test"),
    )
    expect(result._tag).toBe("Left")
    if (result._tag === "Left") {
      expect(result.left._tag).toBe("StoreError")
      expect(result.left.message).toBe("Failed to read")
      expect(result.left.path).toBe("/test")
    }
  }).pipe(Effect.provide(memFsLayer())))

test("withFsError passes through success", () =>
  Effect.gen(function* () {
    const result = yield* withFsError(Effect.succeed(42), "noop")
    expect(result).toBe(42)
  }).pipe(Effect.provide(memFsLayer())))

test("withReadError always maps to StoreError", () =>
  Effect.gen(function* () {
    const result = yield* Effect.either(
      withReadError(Effect.fail({ reason: "BadResource" }), "read", "/data"),
    )
    expect(result._tag).toBe("Left")
    if (result._tag === "Left") {
      expect(result.left._tag).toBe("StoreError")
      expect(result.left.message).toBe("Failed to read")
    }
  }).pipe(Effect.provide(memFsLayer())))

test("withConfigError maps BadResource to DiskFullError", () =>
  Effect.gen(function* () {
    const result = yield* Effect.either(
      withConfigError(Effect.fail({ reason: "BadResource" }), "write config", "/config"),
    )
    expect(result._tag).toBe("Left")
    if (result._tag === "Left") {
      expect(result.left._tag).toBe("DiskFullError")
      expect(result.left.message).toContain("Disk full: could not write config")
    }
  }).pipe(Effect.provide(memFsLayer())))

test("withConfigError maps other errors to ConfigError", () =>
  Effect.gen(function* () {
    const result = yield* Effect.either(
      withConfigError(Effect.fail({ reason: "NotFound" }), "read config"),
    )
    expect(result._tag).toBe("Left")
    if (result._tag === "Left") {
      expect(result.left._tag).toBe("ConfigError")
      expect(result.left.message).toBe("Failed to read config")
    }
  }).pipe(Effect.provide(memFsLayer())))

test("ensureDirExists creates directory when absent", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    yield* ensureDirExists(fs, "/new-dir")
    const exists = yield* fs.exists("/new-dir")
    expect(exists).toBe(true)
  }).pipe(Effect.provide(memFsLayer())))

test("ensureDirExists does nothing when directory exists", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    yield* ensureDirExists(fs, "/existing-dir")
    const exists = yield* fs.exists("/existing-dir")
    expect(exists).toBe(true)
  }).pipe(Effect.provide(memFsLayer({ "/existing-dir": null }))))
