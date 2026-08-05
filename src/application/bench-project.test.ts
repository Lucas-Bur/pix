import { expect, describe, it } from "@effect/vitest"
import { Effect, Fiber, Layer, Ref } from "effect"
import { TestClock } from "effect/testing"

import { makeConfigJson } from "../../tests/test-utils/fixtures.js"
import { silentDisplay } from "../../tests/test-utils/silentDisplay.js"
import { testLayer } from "../../tests/test-utils/testLayer.js"
import type { DeviceType } from "../domain/device.js"
import { ConfigHealError, InferenceError, ModelLoadError } from "../domain/errors.js"
import { ConfigStore, DeviceDetection, Display, Embedder, Scanner } from "../domain/ports.js"
import { ScannerLive } from "../services/scanner.js"
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

const mockDeviceDetection = (devices: readonly DeviceType[]) =>
  Layer.succeed(DeviceDetection, {
    detect: () => Effect.succeed(devices[0]!),
    detectAll: () => Effect.succeed(devices),
  })

const mockEmb = () => ({ vector: new Float32Array(384), dims: 384, dtype: "fp32" as const })
const mockBatch = (texts: readonly string[]) => texts.map(mockEmb)
const mockBoundBase = {
  limits: {
    model: "test-model",
    hardTokenLimit: 512,
    maxInputTokens: 512,
  },
  countTokens: () => Effect.succeed(1),
} as const

const embedderBase = {
  ...mockBoundBase,
  embed: () => Effect.succeed(mockEmb()),
  batch: (texts: readonly string[]) => Effect.succeed(mockBatch(texts)),
  getFallbackInfo: () => Effect.succeed(undefined),
} as const

const createMockEmbedder = () => {
  let createCallCount = 0
  const batchCallCounts: number[] = []

  const layer = Layer.succeed(Embedder, {
    ...embedderBase,
    createForDevice: () =>
      Effect.sync(() => {
        const idx = createCallCount++
        batchCallCounts.push(0)
        return {
          ...mockBoundBase,
          embed: () => Effect.succeed(mockEmb()),
          batch: (texts: readonly string[]) =>
            Effect.sync(() => {
              batchCallCounts[idx] = (batchCallCounts[idx] ?? 0) + 1
              return mockBatch(texts)
            }),
        }
      }),
  })

  return {
    layer,
    getCreateCallCount: () => createCallCount,
    getBatchCallCounts: () => [...batchCallCounts],
  }
}

const createFailingEmbedder = (failDevices: readonly string[]) => {
  let createCallCount = 0
  const batchCallCounts: number[] = []

  const layer = Layer.succeed(Embedder, {
    ...embedderBase,
    createForDevice: (cfg) => {
      if (failDevices.includes(cfg.device)) {
        return Effect.fail(
          new ModelLoadError({
            model: cfg.model,
            message: `Device ${cfg.device} unavailable`,
          }),
        )
      }
      return Effect.sync(() => {
        const idx = createCallCount++
        batchCallCounts.push(0)
        return {
          ...mockBoundBase,
          embed: () => Effect.succeed(mockEmb()),
          batch: (texts: readonly string[]) =>
            Effect.sync(() => {
              batchCallCounts[idx] = (batchCallCounts[idx] ?? 0) + 1
              return mockBatch(texts)
            }),
        }
      })
    },
  })

  return {
    layer,
    getCreateCallCount: () => createCallCount,
    getBatchCallCounts: () => [...batchCallCounts],
  }
}

const createColdStartBatchFailingEmbedder = () => ({
  layer: Layer.succeed(Embedder, {
    ...embedderBase,
    createForDevice: () =>
      Effect.succeed({
        ...mockBoundBase,
        embed: () => Effect.succeed(mockEmb()),
        batch: () =>
          Effect.fail(new InferenceError({ message: "cold-start batch inference failed" })),
      }),
  }),
})

const createWarmPathBatchFailingEmbedder = () => {
  let createCallCount = 0
  const layer = Layer.succeed(Embedder, {
    ...embedderBase,
    createForDevice: () =>
      Effect.sync(() => {
        const idx = createCallCount++
        if (idx === 0) {
          return {
            ...mockBoundBase,
            embed: () => Effect.succeed(mockEmb()),
            batch: (texts: readonly string[]) => Effect.succeed(mockBatch(texts)),
          }
        }
        return {
          ...mockBoundBase,
          embed: () => Effect.succeed(mockEmb()),
          batch: () =>
            Effect.fail(new InferenceError({ message: "warm-path batch inference failed" })),
        }
      }),
  })
  return { layer, getCreateCallCount: () => createCallCount }
}

const createSlowWarmPathEmbedder = () => {
  let createCallCount = 0
  const layer = Layer.succeed(Embedder, {
    ...embedderBase,
    createForDevice: () =>
      Effect.sync(() => {
        const idx = createCallCount++
        if (idx === 0) {
          return {
            ...mockBoundBase,
            embed: () => Effect.succeed(mockEmb()),
            batch: (texts: readonly string[]) => Effect.succeed(mockBatch(texts)),
          }
        }
        return {
          ...mockBoundBase,
          embed: () => Effect.succeed(mockEmb()),
          batch: (texts: readonly string[]) =>
            Effect.sleep("2 seconds").pipe(Effect.andThen(Effect.succeed(mockBatch(texts)))),
        }
      }),
  })
  return { layer }
}

const benchLayer = (
  contents: Record<string, string>,
  opts?: {
    devices?: readonly DeviceType[]
    embedderLayer?: Layer.Layer<Embedder>
    displayLayer?: Layer.Layer<Display>
    scannerLayer?: Layer.Layer<Scanner>
  },
) => {
  const mock = createMockEmbedder()
  const devices = opts?.devices ?? ["cpu"]
  return {
    layer: testLayer({
      contents,
      scannerLayer: opts?.scannerLayer ?? ScannerLive,
      embedderLayer: opts?.embedderLayer ?? mock.layer,
      displayLayer: opts?.displayLayer,
      deviceDetectionLayer: mockDeviceDetection(devices),
    }),
    mock,
  }
}

const edgeCaseSetup = (
  embedderLayer: Layer.Layer<Embedder>,
  opts?: { devices?: readonly DeviceType[]; contents?: Record<string, string> },
) => {
  const { ref, layer: displayLayer } = silentDisplay()
  const devices = opts?.devices ?? ["cpu"]
  const layer = testLayer({
    contents: opts?.contents ?? fixtures,
    scannerLayer: ScannerLive,
    embedderLayer,
    displayLayer,
    deviceDetectionLayer: mockDeviceDetection(devices),
  })
  return { ref, layer }
}

it.effect("(yield* BenchProject).bench reports corpus size", () =>
  Effect.gen(function* () {
    const result = yield* (yield* BenchProject).bench(defaultBenchOpts)
    expect(result.profile).toBe("balanced")
    expect(result.measurements.length).toBeGreaterThan(0)
  }).pipe(Effect.provide(benchLayer(fixtures, { devices: ["cpu"] }).layer), Effect.scoped),
)

it.effect("(yield* BenchProject).bench reports zero chunks for empty project", () => {
  const { ref, layer } = silentDisplay()
  return Effect.gen(function* () {
    const result = yield* (yield* BenchProject).bench(defaultBenchOpts)
    expect(result.measurements).toEqual([])
    expect(result.recommendation.device).toBe("cpu")
    expect(result.recommendation.batchSize).toBe(8)

    const entries = yield* Ref.get(ref)
    const logEntries = entries.filter((e) => e._tag === "log")
    const corpusEntry = logEntries.find((e) => e.message.includes("Found 0 chunks from 0 files"))
    expect(corpusEntry).toBeDefined()
  }).pipe(
    Effect.provide(
      testLayer({
        contents: {},
        displayLayer: layer,
      }).pipe(Layer.merge(mockDeviceDetection(["cpu"]))),
    ),
    Effect.scoped,
  )
})

it.effect("(yield* BenchProject).bench finds chunks from files", () => {
  const { ref, layer } = silentDisplay()
  const { layer: benchL } = benchLayer(fixtures, { displayLayer: layer })
  return Effect.gen(function* () {
    yield* (yield* BenchProject).bench(defaultBenchOpts)

    const entries = yield* Ref.get(ref)
    const logEntries = entries.filter((e) => e._tag === "log")
    const corpusEntry = logEntries.find((e) => e.message.includes("from 2 files"))
    expect(corpusEntry).toBeDefined()
  }).pipe(Effect.provide(benchL), Effect.scoped)
})

it.effect("(yield* BenchProject).prepareCorpus shuffles chunks", () =>
  Effect.gen(function* () {
    let orderDiffers = false
    for (let i = 0; i < 5; i++) {
      const corpus1 = yield* (yield* BenchProject).prepareCorpus(defaultBenchOpts)
      const corpus2 = yield* (yield* BenchProject).prepareCorpus(defaultBenchOpts)

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
  ),
)

it.effect("(yield* BenchProject).prepareCorpus cycles when fewer chunks than needed", () =>
  Effect.gen(function* () {
    const opts = {
      ...defaultBenchOpts,
      warmup: 100,
      measureBatches: 100,
      batchSizes: [128] as const,
    }

    const corpus = yield* (yield* BenchProject).prepareCorpus(opts)

    const needed = opts.warmup * 128 + opts.measureBatches * 128
    expect(corpus.chunkCount).toBe(needed)
    expect(corpus.fileCount).toBe(2)

    const uniqueIds = new Set(corpus.chunks.map((c) => c.id))
    expect(uniqueIds.size).toBeLessThan(corpus.chunkCount)
  }).pipe(
    Effect.provide(testLayer({ contents: fixtures, scannerLayer: ScannerLive })),
    Effect.scoped,
  ),
)

it.effect("(yield* BenchProject).prepareCorpus returns empty corpus for no files", () =>
  Effect.gen(function* () {
    const corpus = yield* (yield* BenchProject).prepareCorpus(defaultBenchOpts)
    expect(corpus.chunks).toEqual([])
    expect(corpus.fileCount).toBe(0)
    expect(corpus.chunkCount).toBe(0)
  }).pipe(Effect.provide(testLayer({ contents: {} })), Effect.scoped),
)

describe("BenchProject measurement pipeline", () => {
  it.effect("measures cold-start and warm-path for each device x batchSize", () => {
    const { layer } = silentDisplay()
    const batchSizes = [4, 16] as const
    const opts = {
      warmup: 2,
      measureBatches: 3,
      batchSizes,
      timeout: 60,
      profile: "balanced" as const,
      json: false,
    }

    return Effect.gen(function* () {
      const result = yield* (yield* BenchProject).bench(opts)

      const okMeasurements = result.measurements.filter((m) => m.status === "ok")
      expect(okMeasurements.length).toBeGreaterThan(0)

      for (const m of okMeasurements) {
        expect(batchSizes).toContain(m.batchSize)
        expect(m.coldLatencyMs).toBeGreaterThanOrEqual(0)
        expect(m.warmChunksPerSec).toBeGreaterThanOrEqual(0)
        expect(m.warmLatencyPerBatchMs).toBeGreaterThanOrEqual(0)
      }
    }).pipe(Effect.provide(benchLayer(fixtures, { displayLayer: layer }).layer), Effect.scoped)
  })

  it.effect("creates embedder per device for cold-start", () => {
    const mock = createMockEmbedder()
    const opts = {
      warmup: 1,
      measureBatches: 1,
      batchSizes: [4] as const,
      timeout: 60,
      profile: "balanced" as const,
      json: false,
    }

    return Effect.gen(function* () {
      yield* (yield* BenchProject).bench(opts)
      expect(mock.getCreateCallCount()).toBeGreaterThan(0)
    }).pipe(
      Effect.provide(
        testLayer({
          contents: fixtures,
          scannerLayer: ScannerLive,
          embedderLayer: mock.layer,
        }).pipe(Layer.merge(mockDeviceDetection(["cpu"]))),
      ),
      Effect.scoped,
    )
  })

  it.effect("outputs table via display", () => {
    const { ref, layer } = silentDisplay()
    const mock = createMockEmbedder()
    return Effect.gen(function* () {
      yield* (yield* BenchProject).bench({
        warmup: 1,
        measureBatches: 1,
        batchSizes: [4] as const,
        timeout: 60,
        profile: "balanced" as const,
      })

      const entries = yield* Ref.get(ref)
      const tableEntries = entries.filter((e) => e._tag === "table")
      expect(tableEntries.length).toBeGreaterThan(0)
      const table = tableEntries[0]!
      expect(table.header).toContain("device")
      expect(table.header).toContain("batchSize")
      expect(table.header).toContain("status")
      expect(table.rows.length).toBeGreaterThan(0)
    }).pipe(
      Effect.provide(
        testLayer({
          contents: fixtures,
          scannerLayer: ScannerLive,
          embedderLayer: mock.layer,
          displayLayer: layer,
        }).pipe(Layer.merge(mockDeviceDetection(["cpu"]))),
      ),
      Effect.scoped,
    )
  })

  it.effect("computes recommendation for throughput profile", () => {
    const mock = createMockEmbedder()
    return Effect.gen(function* () {
      const result = yield* (yield* BenchProject).bench({
        warmup: 1,
        measureBatches: 1,
        batchSizes: [4, 16] as const,
        timeout: 60,
        profile: "throughput" as const,
      })

      expect(result.recommendation.profile).toBe("throughput")
      expect(result.recommendation.device).toBeDefined()
      expect(result.recommendation.batchSize).toBeDefined()
    }).pipe(
      Effect.provide(
        testLayer({
          contents: fixtures,
          scannerLayer: ScannerLive,
          embedderLayer: mock.layer,
        }).pipe(Layer.merge(mockDeviceDetection(["cpu"]))),
      ),
      Effect.scoped,
    )
  })

  it.effect("computes recommendation for cold profile", () => {
    const mock = createMockEmbedder()
    return Effect.gen(function* () {
      const result = yield* (yield* BenchProject).bench({
        warmup: 1,
        measureBatches: 1,
        batchSizes: [4, 16] as const,
        timeout: 60,
        profile: "cold" as const,
      })

      expect(result.recommendation.profile).toBe("cold")
      expect(result.recommendation.device).toBeDefined()
      expect(result.recommendation.batchSize).toBeDefined()
    }).pipe(
      Effect.provide(
        testLayer({
          contents: fixtures,
          scannerLayer: ScannerLive,
          embedderLayer: mock.layer,
        }).pipe(Layer.merge(mockDeviceDetection(["cpu"]))),
      ),
      Effect.scoped,
    )
  })

  it.effect("computes recommendation for balanced profile", () => {
    const mock = createMockEmbedder()
    return Effect.gen(function* () {
      const result = yield* (yield* BenchProject).bench({
        warmup: 1,
        measureBatches: 1,
        batchSizes: [4, 16] as const,
        timeout: 60,
        profile: "balanced" as const,
      })

      expect(result.recommendation.profile).toBe("balanced")
      expect(result.recommendation.device).toBeDefined()
      expect(result.recommendation.batchSize).toBeDefined()
    }).pipe(
      Effect.provide(
        testLayer({
          contents: fixtures,
          scannerLayer: ScannerLive,
          embedderLayer: mock.layer,
        }).pipe(Layer.merge(mockDeviceDetection(["cpu"]))),
      ),
      Effect.scoped,
    )
  })

  it.effect("reports throughput as chunks/sec", () => {
    const mock = createMockEmbedder()
    const batchSize = 16
    return Effect.gen(function* () {
      const result = yield* (yield* BenchProject).bench({
        warmup: 1,
        measureBatches: 2,
        batchSizes: [batchSize] as const,
        timeout: 60,
        profile: "balanced" as const,
      })

      const okMeasurements = result.measurements.filter((m) => m.status === "ok")
      expect(okMeasurements.length).toBeGreaterThan(0)
      const m = okMeasurements[0]!
      const expectedChunks = batchSize * 2
      expect(m.warmChunksPerSec).toBeGreaterThan(0)
      expect(m.warmChunksPerSec).toBeLessThanOrEqual(expectedChunks * 1000)
    }).pipe(
      Effect.provide(
        testLayer({
          contents: fixtures,
          scannerLayer: ScannerLive,
          embedderLayer: mock.layer,
        }).pipe(Layer.merge(mockDeviceDetection(["cpu"]))),
      ),
      Effect.scoped,
    )
  })

  it.effect("outputs three recommendations with active profile highlighted", () => {
    const { ref, layer } = silentDisplay()
    const mock = createMockEmbedder()
    return Effect.gen(function* () {
      yield* (yield* BenchProject).bench({
        warmup: 1,
        measureBatches: 1,
        batchSizes: [4, 16] as const,
        timeout: 60,
        profile: "balanced" as const,
      })

      const entries = yield* Ref.get(ref)
      const logEntries = entries.filter((e) => e._tag === "log")
      const successEntries = logEntries.filter((e) => e.severity === "success")
      const infoEntries = logEntries.filter((e) => e.severity === "info")

      const recSuccess = successEntries.find((e) => e.message.includes("balanced"))
      expect(recSuccess).toBeDefined()

      const recThroughput = infoEntries.find((e) => e.message.includes("throughput"))
      expect(recThroughput).toBeDefined()
      expect(recThroughput!.severity).toBe("info")

      const recCold = infoEntries.find((e) => e.message.includes("cold"))
      expect(recCold).toBeDefined()
      expect(recCold!.severity).toBe("info")
    }).pipe(
      Effect.provide(
        testLayer({
          contents: fixtures,
          scannerLayer: ScannerLive,
          embedderLayer: mock.layer,
          displayLayer: layer,
        }).pipe(Layer.merge(mockDeviceDetection(["cpu"]))),
      ),
      Effect.scoped,
    )
  })

  it.effect("marks failed device with dash for batchSize in table", () => {
    const { ref, layer } = silentDisplay()
    const mock = createFailingEmbedder(["cuda"])
    return Effect.gen(function* () {
      yield* (yield* BenchProject).bench({
        warmup: 1,
        measureBatches: 1,
        batchSizes: [4] as const,
        timeout: 60,
        profile: "balanced" as const,
      })

      const entries = yield* Ref.get(ref)
      const tableEntries = entries.filter((e) => e._tag === "table")
      expect(tableEntries.length).toBeGreaterThan(0)
      const table = tableEntries[0]!
      const cudaRow = table.rows.find((r) => r[0] === "cuda")
      expect(cudaRow).toBeDefined()
      expect(cudaRow![1]).toBe("—")
      expect(cudaRow![5]).toBe("failed")
    }).pipe(
      Effect.provide(
        testLayer({
          contents: fixtures,
          scannerLayer: ScannerLive,
          embedderLayer: mock.layer,
          displayLayer: layer,
          deviceDetectionLayer: mockDeviceDetection(["cuda", "cpu"]),
        }),
      ),
      Effect.scoped,
    )
  })
})

describe("(yield* BenchProject).applyConfig", () => {
  it.effect("patches device and batchSize from recommendation", () =>
    Effect.gen(function* () {
      yield* (yield* BenchProject).applyConfig({
        device: "cuda",
        batchSize: 64,
        profile: "throughput",
      })

      const store = yield* ConfigStore
      const config = yield* store.readConfig()
      expect(config.embedder.device).toBe("cuda")
      expect(config.embedder.batchSize).toBe(64)
      expect(config.chunkTokens).toBeUndefined()
      expect(config.embedder.model).toBe("Xenova/all-MiniLM-L6-v2")
    }).pipe(
      Effect.provide(testLayer({ contents: { ".pix/config.json": makeConfigJson() } })),
      Effect.scoped,
    ),
  )

  it.effect("creates default config when missing", () =>
    Effect.gen(function* () {
      yield* (yield* BenchProject).applyConfig({ device: "cpu", batchSize: 32, profile: "cold" })

      const store = yield* ConfigStore
      const config = yield* store.readConfig()
      expect(config.embedder.device).toBe("cpu")
      expect(config.embedder.batchSize).toBe(32)
    }).pipe(Effect.provide(testLayer({ contents: {} })), Effect.scoped),
  )

  it.effect("preserves user settings when patching", () => {
    const configContent = makeConfigJson({
      chunkTokens: 100,
      overlapLines: 20,
      embedder: { device: "auto", batchSize: 8, model: "Xenova/bge-small-en-v1.5" },
    })
    return Effect.gen(function* () {
      yield* (yield* BenchProject).applyConfig({
        device: "dml",
        batchSize: 128,
        profile: "balanced",
      })

      const store = yield* ConfigStore
      const config = yield* store.readConfig()
      expect(config.embedder.device).toBe("dml")
      expect(config.embedder.batchSize).toBe(128)
      expect(config.chunkTokens).toBe(100)
      expect(config.overlapLines).toBe(20)
      expect(config.embedder.model).toBe("Xenova/bge-small-en-v1.5")
    }).pipe(
      Effect.provide(testLayer({ contents: { ".pix/config.json": configContent } })),
      Effect.scoped,
    )
  })
})

describe("BenchProject error and edge cases", () => {
  it.effect("returns the default recommendation when detection returns no devices", () => {
    const mock = createMockEmbedder()
    const { layer } = edgeCaseSetup(mock.layer, { devices: [] })
    return Effect.gen(function* () {
      const result = yield* (yield* BenchProject).bench(defaultBenchOpts)

      expect(result.measurements).toEqual([])
      expect(result.recommendation.device).toBe("cpu")
      expect(result.recommendation.batchSize).toBe(8)
    }).pipe(Effect.provide(layer), Effect.scoped)
  })

  it.effect("fails with ModelLoadError when model is unknown", () => {
    const mock = createMockEmbedder()
    const configWithUnknownModel = makeConfigJson({
      embedder: { model: "unknown/model", device: "cpu", dtype: "fp32", batchSize: 8 },
    })
    const { layer } = edgeCaseSetup(mock.layer, {
      contents: { ...fixtures, ".pix/config.json": configWithUnknownModel },
    })
    return Effect.gen(function* () {
      const error = yield* Effect.flip((yield* BenchProject).bench(defaultBenchOpts))
      expect(error).toBeInstanceOf(ConfigHealError)
      if (error instanceof ConfigHealError) {
        expect(error.conflicts[0]?.currentValue).toBe("unknown/model")
      }
    }).pipe(Effect.provide(layer), Effect.scoped)
  })

  it.effect("logs warning when all devices fail cold-start", () => {
    const mock = createFailingEmbedder(["cpu"])
    const { ref, layer } = edgeCaseSetup(mock.layer)
    return Effect.gen(function* () {
      const result = yield* (yield* BenchProject).bench({
        warmup: 1,
        measureBatches: 1,
        batchSizes: [4] as const,
        timeout: 60,
        profile: "balanced" as const,
      })

      const failedMeasurements = result.measurements.filter((m) => m.status === "failed")
      expect(failedMeasurements.length).toBe(1)
      expect(result.recommendation.device).toBe("cpu")
      expect(result.recommendation.batchSize).toBe(8)

      const entries = yield* Ref.get(ref)
      const logEntries = entries.filter((e) => e._tag === "log")
      const warnEntry = logEntries.find(
        (e) => e.severity === "warn" && e.message.includes("No successful measurements"),
      )
      expect(warnEntry).toBeDefined()
    }).pipe(Effect.provide(layer), Effect.scoped)
  })

  it.effect("marks device as failed when cold-start batch fails (createForDevice succeeds)", () => {
    const mock = createColdStartBatchFailingEmbedder()
    const { ref, layer } = edgeCaseSetup(mock.layer)
    return Effect.gen(function* () {
      const result = yield* (yield* BenchProject).bench({
        warmup: 1,
        measureBatches: 1,
        batchSizes: [4, 16] as const,
        timeout: 60,
        profile: "balanced" as const,
      })

      const failedMeasurements = result.measurements.filter((m) => m.status === "failed")
      expect(failedMeasurements.length).toBe(1)
      expect(failedMeasurements[0]!.error).toContain("cold-start batch inference failed")
      expect(failedMeasurements[0]!.batchSize).toBe(0)

      const entries = yield* Ref.get(ref)
      const tableEntries = entries.filter((e) => e._tag === "table")
      expect(tableEntries.length).toBeGreaterThan(0)
      const table = tableEntries[0]!
      const statusCol = table.header.findIndex((h) => /status/i.test(h))
      const batchCol = table.header.findIndex((h) => /batch/i.test(h))
      expect(statusCol).toBeGreaterThanOrEqual(0)
      expect(batchCol).toBeGreaterThanOrEqual(0)
      const failedRow = table.rows.find((r) => r[statusCol] === "failed")
      expect(failedRow).toBeDefined()
      expect(failedRow![batchCol]).toBe("—")
    }).pipe(Effect.provide(layer), Effect.scoped)
  })

  it.effect("marks measurement as failed when warm-path batch fails", () => {
    const mock = createWarmPathBatchFailingEmbedder()
    const { layer } = edgeCaseSetup(mock.layer)
    return Effect.gen(function* () {
      const result = yield* (yield* BenchProject).bench({
        warmup: 1,
        measureBatches: 1,
        batchSizes: [4, 16] as const,
        timeout: 60,
        profile: "balanced" as const,
      })

      const okMeasurements = result.measurements.filter((m) => m.status === "ok")
      const failedMeasurements = result.measurements.filter((m) => m.status === "failed")
      expect(okMeasurements).toHaveLength(0)
      expect(failedMeasurements.length).toBe(2)
      for (const m of failedMeasurements) {
        expect(m.error).toContain("warm-path batch inference failed")
        expect(m.batchSize).toBeGreaterThan(0)
      }
    }).pipe(Effect.provide(layer), Effect.scoped)
  })

  it.effect("marks measurement as failed with timeout error when warm-path exceeds timeout", () => {
    const mock = createSlowWarmPathEmbedder()
    const { layer } = edgeCaseSetup(mock.layer)
    return Effect.gen(function* () {
      const benchProject = yield* BenchProject
      const fiber = yield* benchProject
        .bench({
          warmup: 2,
          measureBatches: 2,
          batchSizes: [4] as const,
          timeout: 1,
          profile: "balanced" as const,
        })
        .pipe(Effect.forkChild)
      for (let i = 0; i < 3; i++) {
        yield* Effect.yieldNow
        yield* TestClock.adjust("1 second")
      }
      const result = yield* Fiber.join(fiber)

      const failedMeasurements = result.measurements.filter((m) => m.status === "failed")
      expect(failedMeasurements.length).toBe(1)
      expect(failedMeasurements[0]!.error).toBe("timeout")
    }).pipe(Effect.provide(layer), Effect.scoped)
  })

  it.effect("writes default config when missing during corpus preparation", () =>
    Effect.gen(function* () {
      const store = yield* ConfigStore

      const existsBefore = yield* store.configExists()
      expect(existsBefore).toBe(false)

      yield* (yield* BenchProject).prepareCorpus(defaultBenchOpts)

      const existsAfter = yield* store.configExists()
      expect(existsAfter).toBe(true)

      const config = yield* store.readConfig()
      expect(config.embedder.model).toBe("Xenova/all-MiniLM-L6-v2")
    }).pipe(
      Effect.provide(
        testLayer({ contents: fixtures, scannerLayer: ScannerLive }).pipe(
          Layer.merge(mockDeviceDetection(["cpu"])),
        ),
      ),
      Effect.scoped,
    ),
  )
})
