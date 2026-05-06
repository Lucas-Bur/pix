import { FileSystem } from "@effect/platform"
import { NodeFileSystem } from "@effect/platform-node"
import { Effect } from "effect"
import { expect, test } from "vite-plus/test"

import { readConfig } from "../services/store.ts"
import { runInit } from "./init.ts"

const cleanPixDir = (): Effect.Effect<void, never, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    yield* fs.remove(".pix", { recursive: true })
  }).pipe(Effect.catchAll(() => Effect.void))

test("pix init creates .pix/config.json with defaults", () =>
  Effect.gen(function* () {
    yield* cleanPixDir()

    yield* runInit

    const config = yield* readConfig()
    expect(config.schema).toBe("1")
    expect(config.model).toBe("Xenova/all-MiniLM-L6-v2")
    expect(config.dims).toBe(384)
    expect(config.chunkLines).toBe(60)
    expect(config.overlapLines).toBe(10)
    expect(config.files).toEqual({})
  }).pipe(Effect.provide(NodeFileSystem.layer)))

test("pix init outputs .gitignore reminder", () =>
  Effect.gen(function* () {
    yield* cleanPixDir()

    const exit = yield* Effect.exit(runInit)
    expect(exit._tag).toBe("Success")
  }).pipe(Effect.provide(NodeFileSystem.layer)))
