import { Cause, Effect, Exit } from "effect"
import { expect, test } from "vite-plus/test"

import { makeFailingIndexStore } from "../../tests/test-utils/command.js"
import { makeConfigJson } from "../../tests/test-utils/fixtures.js"
import { testLayer } from "../../tests/test-utils/testLayer.js"
import type { Config } from "../domain/config.js"
import { StoreError } from "../domain/errors.js"
import { ConfigStore } from "../domain/ports.js"
import { ScannerLive } from "../services/scanner.ts"
import { IndexProject } from "./index-project.js"

const makeConfig = (overrides: Record<string, unknown> = {}): string =>
  makeConfigJson(overrides as Record<string, unknown> & Partial<Config>)

const sourceFile = `import { Effect } from "effect"
// Line 2 - ${"padding ".repeat(50)}
export interface AppConfig { name: string; version: string }
// Line 5 - ${"padding ".repeat(50)}
export const DEFAULT_NAME = "pix-app"
// Line 8 - ${"padding ".repeat(50)}
export const createConfig = (name: string) => ({ name, version: "1.0.0" })
// Line 11 - ${"padding ".repeat(50)}
export class Service extends Effect.Service<Service>()("Service", {
  accessors: true,
  effect: Effect.gen(function* () { return {} }),
}) {}
// Line 17 - ${"padding ".repeat(50)}
export const isValid = (v: number) => v > 0 && v < 100
// Line 20 - ${"padding ".repeat(50)}
export const transform = (data: readonly string[]) => data.map((s) => s.trim())
// Line 23 - ${"padding ".repeat(50)}
export const DEFAULT_TIMEOUT = 5000
// Line 26 - ${"padding ".repeat(50)}
export const MAX_RETRIES = 3
// Line 29 - ${"padding ".repeat(50)}
export const BATCH_SIZE = 16
// Line 32 - ${"padding ".repeat(50)}
export const OVERLAP_VALUE = 10
// Line 35 - ${"padding ".repeat(50)}
export const MIN_CHUNK = 20
// Line 38 - ${"padding ".repeat(50)}
export const readConfig = async () => ({ name: "test" })
// Line 41 - ${"padding ".repeat(50)}
export const writeConfig = async (cfg: AppConfig) => { void cfg }
// Line 44 - ${"padding ".repeat(50)}
export const parseArgs = (argv: readonly string[]) => argv.slice(2)
// Line 47 - ${"padding ".repeat(50)}
export const formatOutput = (data: unknown) => JSON.stringify(data)
// Line 50 - ${"padding ".repeat(50)}
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
// Line 53 - ${"padding ".repeat(50)}
export const randomId = () => Math.random().toString(36).slice(2, 10)
// Line 56 - ${"padding ".repeat(50)}
export const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v))
// Line 59 - ${"padding ".repeat(50)}
export const sum = (arr: readonly number[]) => arr.reduce((a, b) => a + b, 0)
// Line 62 - ${"padding ".repeat(50)}
export const average = (arr: readonly number[]) => sum(arr) / arr.length
// Line 65 - ${"padding ".repeat(50)}
`

const fixtures = {
  "src/a.ts": sourceFile,
  "src/b.ts": sourceFile,
}

test("IndexProject.index scans, chunks, embeds, and stores", () =>
  Effect.gen(function* () {
    const result = yield* (yield* IndexProject).index()
    expect(result.success).toBe(true)
    expect(result.status.chunks).toBeGreaterThan(0)
    expect(result.status.files).toBe(2)
    expect(result.status.totalLines).toBeGreaterThan(0)
  }).pipe(
    Effect.provide(testLayer({ contents: fixtures, scannerLayer: ScannerLive })),
    Effect.scoped,
  ))

test("IndexProject.index propagates errors from IndexStore", () =>
  Effect.gen(function* () {
    const exit = yield* Effect.exit((yield* IndexProject).index()).pipe(
      Effect.provide(
        testLayer({
          contents: fixtures,
          scannerLayer: ScannerLive,
          indexStoreLayer: makeFailingIndexStore("storeBatch"),
        }),
      ),
    )

    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) {
      expect(exit.cause.reasons[0]._tag).toBe("Fail")
      const failReason = exit.cause.reasons[0] as Cause.Fail<StoreError>
      expect(failReason.error).toBeInstanceOf(StoreError)
    }
  }))

test("IndexProject.index returns zero status when no files found", () =>
  Effect.gen(function* () {
    const result = yield* (yield* IndexProject).index()
    expect(result.success).toBe(true)
    expect(result.status.chunks).toBe(0)
    expect(result.status.files).toBe(0)
    expect(result.status.totalLines).toBe(0)
    expect(result.status.byteSize).toBe(0)
  }).pipe(Effect.provide(testLayer({})), Effect.scoped))

test("IndexProject.index uses custom extensions from config", () =>
  Effect.gen(function* () {
    const result = yield* (yield* IndexProject).index()
    expect(result.success).toBe(true)
    expect(result.status.chunks).toBeGreaterThan(0)
    expect(result.status.files).toBe(1)
  }).pipe(
    Effect.provide(
      testLayer({
        contents: {
          ".pix/config.json": makeConfig(),
          "src/script.py": `# Python script\n${"print('line')\n".repeat(70)}`,
        },
        scannerLayer: ScannerLive,
      }),
    ),
    Effect.scoped,
  ))

test("IndexProject.index respects chunkConcurrency values", () =>
  Effect.gen(function* () {
    for (const { label, chunkConcurrency } of [
      { label: "missing (default 8)", chunkConcurrency: undefined },
      { label: "explicit 1", chunkConcurrency: 1 },
      { label: "clamped 0 to 1", chunkConcurrency: 0 },
      { label: "high 64", chunkConcurrency: 64 },
    ]) {
      const configObj = chunkConcurrency !== undefined ? { chunkConcurrency } : {}

      const result = yield* (yield* IndexProject).index().pipe(
        Effect.provide(
          testLayer({
            contents: {
              ".pix/config.json": makeConfig(configObj),
              "src/a.ts": sourceFile,
              "src/b.ts": sourceFile,
            },
            scannerLayer: ScannerLive,
          }),
        ),
        Effect.scoped,
      )

      expect(result.success, `chunkConcurrency=${label}`).toBe(true)
      expect(result.status.chunks, `chunkConcurrency=${label}`).toBeGreaterThan(0)
      expect(result.status.files, `chunkConcurrency=${label}`).toBe(2)
    }
  }))

test("IndexProject.index auto-initializes when config is missing", () =>
  Effect.gen(function* () {
    const configStore = yield* ConfigStore
    expect(yield* configStore.configExists()).toBe(false)

    const result = yield* (yield* IndexProject).index()
    expect(result.success).toBe(true)
    const exists = yield* configStore.configExists()
    expect(exists).toBe(true)
  }).pipe(
    Effect.provide(
      testLayer({
        contents: { "src/a.ts": sourceFile },
        scannerLayer: ScannerLive,
      }),
    ),
    Effect.scoped,
  ))

test("IndexProject.index skips files with unknown extensions", () =>
  Effect.gen(function* () {
    const result = yield* (yield* IndexProject).index()
    expect(result.success).toBe(true)
    expect(result.status.files).toBe(1)
  }).pipe(
    Effect.provide(
      testLayer({
        contents: {
          "src/a.ts": sourceFile,
          "docs/manual.xyz": "some content with unknown extension type here",
        },
        scannerLayer: ScannerLive,
      }),
    ),
    Effect.scoped,
  ))

test("IndexProject.index skips files in skipExtensions", () =>
  Effect.gen(function* () {
    const result = yield* (yield* IndexProject).index()
    expect(result.success).toBe(true)
    expect(result.status.files).toBe(1)
  }).pipe(
    Effect.provide(
      testLayer({
        contents: {
          ".pix/config.json": makeConfig({ skipExtensions: [".py"] }),
          "src/a.ts": sourceFile,
          "src/script.py": `# Python script\n${"print('line')\n".repeat(70)}`,
        },
        scannerLayer: ScannerLive,
      }),
    ),
    Effect.scoped,
  ))
