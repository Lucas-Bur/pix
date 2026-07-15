import { expect, it } from "@effect/vitest"
import { layer, type FileTree } from "@lucas-bur/effect-memfs"
import { Effect, Result } from "effect"
import { FileSystem } from "effect/FileSystem"

import { ensureDirExists, withFsError, withReadError, withConfigError } from "./fs-error.js"

const memFsLayer = (contents?: FileTree) => layer(contents ?? {})

const expectErrorResult = <A extends { _tag: string; message: string; path?: string }>(
  result: Result.Result<never, A>,
  assertions: (err: A) => void,
) => {
  expect(Result.isFailure(result)).toBe(true)
  if (Result.isFailure(result)) {
    assertions(result.failure)
  }
}
it.effect("withFsError maps BadResource to DiskFullError", () =>
  Effect.gen(function* () {
    const result = yield* Effect.result(
      withFsError(Effect.fail({ reason: "BadResource", message: "disk full" }), "write", "/test"),
    )
    expectErrorResult(result, (err) => {
      expect(err._tag).toBe("DiskFullError")
      expect(err.message).toContain("Disk full during write")
      expect(err.path).toBe("/test")
    })
  }).pipe(Effect.provide(memFsLayer())),
)

it.effect("withFsError maps other errors to StoreError", () =>
  Effect.gen(function* () {
    const result = yield* Effect.result(
      withFsError(Effect.fail({ reason: "Unknown", message: "oops" }), "read", "/test"),
    )
    expectErrorResult(result, (err) => {
      expect(err._tag).toBe("StoreError")
      expect(err.message).toBe("Failed to read")
      expect(err.path).toBe("/test")
    })
  }).pipe(Effect.provide(memFsLayer())),
)

it.effect("withFsError passes through success", () =>
  Effect.gen(function* () {
    const result = yield* withFsError(Effect.succeed(42), "noop")
    expect(result).toBe(42)
  }).pipe(Effect.provide(memFsLayer())),
)

it.effect("withReadError always maps to StoreError", () =>
  Effect.gen(function* () {
    const result = yield* Effect.result(
      withReadError(Effect.fail({ reason: "BadResource" }), "read", "/data"),
    )
    expectErrorResult(result, (err) => {
      expect(err._tag).toBe("StoreError")
      expect(err.message).toBe("Failed to read")
    })
  }).pipe(Effect.provide(memFsLayer())),
)

it.effect("withConfigError maps BadResource to DiskFullError", () =>
  Effect.gen(function* () {
    const result = yield* Effect.result(
      withConfigError(Effect.fail({ reason: "BadResource" }), "write config", "/config"),
    )
    expectErrorResult(result, (err) => {
      expect(err._tag).toBe("DiskFullError")
      expect(err.message).toContain("Disk full: could not write config")
    })
  }).pipe(Effect.provide(memFsLayer())),
)

it.effect("withConfigError maps other errors to ConfigError", () =>
  Effect.gen(function* () {
    const result = yield* Effect.result(
      withConfigError(Effect.fail({ reason: "NotFound" }), "read config"),
    )
    expectErrorResult(result, (err) => {
      expect(err._tag).toBe("ConfigError")
      expect(err.message).toBe("Failed to read config")
    })
  }).pipe(Effect.provide(memFsLayer())),
)

it.effect("ensureDirExists creates directory when absent", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem
    yield* ensureDirExists(fs, "/new-dir")
    const exists = yield* fs.exists("/new-dir")
    expect(exists).toBe(true)
  }).pipe(Effect.provide(memFsLayer())),
)

it.effect("ensureDirExists does nothing when directory exists", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem
    yield* ensureDirExists(fs, "/existing-dir")
    const exists = yield* fs.exists("/existing-dir")
    expect(exists).toBe(true)
  }).pipe(Effect.provide(memFsLayer({ "/existing-dir": null }))),
)
