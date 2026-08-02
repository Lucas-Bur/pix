import { expect, it } from "@effect/vitest"
import { Console, Effect, Exit } from "effect"
import { FileSystem } from "effect/FileSystem"

import { makeFailingIndexStore } from "../../tests/test-utils/command.js"
import { makeConfigJson, TEST_CONFIG_JSON } from "../../tests/test-utils/fixtures.js"
import { testLayer } from "../../tests/test-utils/testLayer.js"
import type { Config } from "../domain/config.js"
import { StoreError } from "../domain/errors.js"
import { ConfigStore, IndexStore } from "../domain/ports.js"
import { ScannerLive } from "../services/scanner.js"
import { IndexProject } from "./index-project.js"
import { QueryProject } from "./query-project.js"

const makeConfig = (overrides: Partial<Config> = {}): string => makeConfigJson(overrides)

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

it.effect("IndexProject.index scans, chunks, embeds, and stores", () =>
  Effect.gen(function* () {
    const result = yield* (yield* IndexProject).index()
    expect(result.success).toBe(true)
    expect(result.status.chunks).toBeGreaterThan(0)
    expect(result.status.files).toBe(2)
    expect(result.status.totalLines).toBeGreaterThan(0)
  }).pipe(
    Effect.provide(testLayer({ contents: fixtures, scannerLayer: ScannerLive })),
    Effect.scoped,
  ),
)

it.effect("IndexProject.index performs no embedding or commit when all files are unchanged", () =>
  Effect.gen(function* () {
    const index = yield* IndexProject
    const first = yield* index.index()
    const second = yield* index.index()

    expect(first.processedFiles).toBe(2)
    expect(first.refresh).toBe("full")
    expect(first.cacheMisses).toBe(1)
    expect(second.reusedFiles).toBe(2)
    expect(second.refresh).toBe("none")
    expect(second.processedFiles).toBe(0)
    expect(second.cacheHits).toBe(0)
    expect(second.cacheMisses).toBe(0)
  }).pipe(
    Effect.provide(testLayer({ contents: fixtures, scannerLayer: ScannerLive })),
    Effect.scoped,
  ),
)

it.effect("IndexProject.index handles changed, deleted, and renamed files", () =>
  Effect.gen(function* () {
    const index = yield* IndexProject
    const fs = yield* FileSystem
    yield* index.index()

    yield* fs.writeFileString("src/a.ts", `${sourceFile}\nexport const changed = true`)
    yield* fs.remove("src/b.ts")
    yield* fs.writeFileString("src/renamed.ts", sourceFile)
    const result = yield* index.index()

    expect(result.status.files).toBe(2)
    expect(result.refresh).toBe("incremental")
    expect(result.processedFiles).toBe(2)
    expect(result.cacheHits).toBeGreaterThan(0)
    const query = yield* (yield* QueryProject).queryProject("createConfig", {
      topK: 10,
      noContent: true,
    })
    expect(query.results.some((entry) => entry.file.endsWith("renamed.ts"))).toBe(true)
    expect(query.results.some((entry) => entry.file.endsWith("b.ts"))).toBe(false)
  }).pipe(
    Effect.provide(testLayer({ contents: fixtures, scannerLayer: ScannerLive })),
    Effect.scoped,
  ),
)

it.effect("IndexProject keeps only displaced embeddings in the historical cache", () =>
  Effect.gen(function* () {
    const index = yield* IndexProject
    const store = yield* IndexStore
    const fs = yield* FileSystem
    yield* index.index()
    expect(yield* store.loadEmbeddingCache()).toHaveLength(0)
    expect(yield* store.loadSparseEmbeddingCache()).toHaveLength(0)

    yield* fs.writeFileString("src/a.ts", `${sourceFile}\nexport const changed = true`)
    yield* index.index()
    expect((yield* store.loadEmbeddingCache()).length).toBeGreaterThan(0)
    expect((yield* store.loadSparseEmbeddingCache()).length).toBeGreaterThan(0)

    yield* fs.writeFileString("src/a.ts", sourceFile)
    const reverted = yield* index.index()
    expect(reverted.cacheHits).toBeGreaterThan(0)
  }).pipe(
    Effect.provide(testLayer({ contents: { "src/a.ts": sourceFile }, scannerLayer: ScannerLive })),
    Effect.scoped,
  ),
)

it.effect("IndexProject.index propagates errors from IndexStore", () =>
  Effect.gen(function* () {
    const exit = yield* Effect.exit((yield* IndexProject).index())

    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) {
      expect(exit.cause.reasons[0]._tag).toBe("Fail")
      const failReason = exit.cause.reasons[0]
      if (failReason._tag === "Fail") {
        expect(failReason.error).toBeInstanceOf(StoreError)
      }
    }
  }).pipe(
    Effect.provide(
      testLayer({
        contents: fixtures,
        scannerLayer: ScannerLive,
        indexStoreLayer: makeFailingIndexStore("persistIndex"),
      }),
    ),
    Effect.scoped,
  ),
)

it.effect("IndexProject.index returns zero status when no files found", () =>
  Effect.gen(function* () {
    const result = yield* (yield* IndexProject).index()
    expect(result.success).toBe(true)
    expect(result.status.chunks).toBe(0)
    expect(result.status.files).toBe(0)
    expect(result.status.totalLines).toBe(0)
    expect(result.status.byteSize).toBe(0)
  }).pipe(Effect.provide(testLayer({})), Effect.scoped),
)

it.effect("IndexProject.index uses custom extensions from config", () =>
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
  ),
)

it.effect("IndexProject.index assigns global chunk indices to identifiers across files", () =>
  Effect.gen(function* () {
    yield* (yield* IndexProject).index()
    const store = yield* IndexStore
    const { identifierIndex, entries } = yield* store.loadSearchData()

    expect(entries.length).toBe(2)
    const alphaIdxs = identifierIndex.exact["alpha"]
    const betaIdxs = identifierIndex.exact["beta"]
    expect(alphaIdxs).toBeDefined()
    expect(betaIdxs).toBeDefined()
    expect(alphaIdxs.length).toBe(1)
    expect(betaIdxs.length).toBe(1)
    expect(alphaIdxs[0]).not.toBe(betaIdxs[0])
    Effect.runSync(Console.log(alphaIdxs, betaIdxs))
  }).pipe(
    Effect.provide(
      testLayer({
        contents: {
          ".pix/config.json": TEST_CONFIG_JSON,
          "src/idx_a.ts": "export function alpha() { return 1 }",
          "src/idx_b.ts": "export function beta() { return 2 }",
        },
        scannerLayer: ScannerLive,
      }),
    ),
    Effect.scoped,
  ),
)

it.effect("IndexProject.index respects chunkConcurrency values", () =>
  Effect.gen(function* () {
    for (const { label, chunkConcurrency } of [
      { label: "missing (default 8)", chunkConcurrency: undefined },
      { label: "explicit 1", chunkConcurrency: 1 },
      { label: "clamped 0 to 1", chunkConcurrency: 0 },
      { label: "high 64", chunkConcurrency: 64 },
    ]) {
      const configObj = chunkConcurrency !== undefined ? { chunkConcurrency } : {}

      const result = yield* Effect.gen(function* () {
        return yield* (yield* IndexProject).index()
      }).pipe(
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
  }),
)

it.effect("IndexProject.index auto-initializes when config is missing", () =>
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
  ),
)

it.effect("IndexProject.index skips files with unknown extensions", () =>
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
  ),
)

it.effect("IndexProject.index skips files in skipExtensions", () =>
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
  ),
)
