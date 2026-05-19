import { Effect, Ref } from "effect"
import { expect, test } from "vite-plus/test"

import { silentDisplay } from "../../tests/test-utils/silentDisplay.js"
import { testLayer } from "../../tests/test-utils/testLayer.js"
import { ScannerLive } from "../services/scanner.ts"
import { BenchProject } from "./bench-project.js"

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

const defaultBenchOpts = {
  warmup: 5,
  measureBatches: 10,
  batchSizes: [1, 4, 8, 16, 32, 64, 96, 128] as const,
  timeout: 60,
  profile: "balanced" as const,
  json: false,
}

test("BenchProject.bench reports corpus size", () =>
  Effect.gen(function* () {
    const result = yield* BenchProject.bench(defaultBenchOpts)
    expect(result.profile).toBe("balanced")
    expect(result.recommendation).toBe("measurement pipeline not yet implemented")
    expect(result.measurements).toEqual([])
  }).pipe(
    Effect.provide(testLayer({ contents: fixtures, scannerLayer: ScannerLive })),
    Effect.scoped,
  ))

test("BenchProject.bench reports zero chunks for empty project", () => {
  const { ref, layer } = silentDisplay()
  return Effect.gen(function* () {
    const result = yield* BenchProject.bench(defaultBenchOpts)
    expect(result.recommendation).toBe("measurement pipeline not yet implemented")

    const entries = yield* Ref.get(ref)
    const logEntries = entries.filter((e) => e._tag === "log")
    const corpusEntry = logEntries.find((e) => e.message.includes("Found 0 chunks from 0 files"))
    expect(corpusEntry).toBeDefined()
  }).pipe(Effect.provide(testLayer({ contents: {}, displayLayer: layer })), Effect.scoped)
})

test("BenchProject.bench finds chunks from files", () => {
  const { ref, layer } = silentDisplay()
  return Effect.gen(function* () {
    yield* BenchProject.bench(defaultBenchOpts)

    const entries = yield* Ref.get(ref)
    const logEntries = entries.filter((e) => e._tag === "log")
    const corpusEntry = logEntries.find((e) => e.message.includes("chunks from 2 files"))
    expect(corpusEntry).toBeDefined()
  }).pipe(
    Effect.provide(
      testLayer({ contents: fixtures, scannerLayer: ScannerLive, displayLayer: layer }),
    ),
    Effect.scoped,
  )
})

test("BenchProject.prepareCorpus shuffles chunks", () =>
  Effect.gen(function* () {
    let orderDiffers = false
    for (let i = 0; i < 5; i++) {
      const corpus1 = yield* BenchProject.prepareCorpus(defaultBenchOpts)
      const corpus2 = yield* BenchProject.prepareCorpus(defaultBenchOpts)

      expect(corpus1.chunkCount).toBe(corpus2.chunkCount)
      expect(corpus1.chunkCount).toBeGreaterThan(0)

      if (corpus1.chunks.some((c, j) => c.id !== corpus2.chunks[j]?.id)) {
        orderDiffers = true
        break
      }
    }
    expect(orderDiffers).toBe(true)
  }).pipe(
    Effect.provide(testLayer({ contents: fixtures, scannerLayer: ScannerLive })),
    Effect.scoped,
  ))

test("BenchProject.prepareCorpus cycles when fewer chunks than needed", () =>
  Effect.gen(function* () {
    const opts = {
      ...defaultBenchOpts,
      warmup: 100,
      measureBatches: 100,
      batchSizes: [128] as const,
    }

    const corpus = yield* BenchProject.prepareCorpus(opts)

    const needed = opts.warmup * 128 + opts.measureBatches * 128
    expect(corpus.chunkCount).toBe(needed)
    expect(corpus.fileCount).toBe(2)

    const uniqueIds = new Set(corpus.chunks.map((c) => c.id))
    expect(uniqueIds.size).toBeLessThan(corpus.chunkCount)
  }).pipe(
    Effect.provide(testLayer({ contents: fixtures, scannerLayer: ScannerLive })),
    Effect.scoped,
  ))

test("BenchProject.prepareCorpus returns empty corpus for no files", () =>
  Effect.gen(function* () {
    const corpus = yield* BenchProject.prepareCorpus(defaultBenchOpts)
    expect(corpus.chunks).toEqual([])
    expect(corpus.fileCount).toBe(0)
    expect(corpus.chunkCount).toBe(0)
  }).pipe(Effect.provide(testLayer({ contents: {} })), Effect.scoped))
