import { pipeline as mockPipeline } from "@huggingface/transformers"
import { Effect, Layer, Ref } from "effect"
import { expect, test, describe, vi, beforeEach } from "vite-plus/test"

import { makeConfigJson } from "../../tests/test-utils/fixtures.js"
import { memoryFsLayer } from "../../tests/test-utils/memfs.js"
import { silentDisplay } from "../../tests/test-utils/silentDisplay.js"
import { ModelLoadError } from "../domain/errors.js"
import type { EmbedderDeviceConfig } from "../domain/ports.js"
import { Embedder } from "../domain/ports.js"
import { OnnxEmbedderLive } from "./embedder.js"

vi.mock("@huggingface/transformers", () => ({
  pipeline: vi.fn(),
  env: { cacheDir: ".pix/cache" },
}))

const mockedPipeline = vi.mocked(mockPipeline)

const DIMS = 384

const makeMockExtractor = () =>
  vi.fn((input: string | string[]) => {
    const n = Array.isArray(input) ? input.length : 1
    return Promise.resolve({
      data: new Float32Array(n * DIMS),
      dims: [n, DIMS],
    })
  })

const buildLayer = (configJson: string) => {
  const { ref, layer: displayLayer } = silentDisplay()
  return {
    ref,
    layer: Layer.provideMerge(
      OnnxEmbedderLive,
      Layer.mergeAll(memoryFsLayer({ ".pix/config.json": configJson }), displayLayer),
    ),
  }
}

const defaultCpuLayer = () => {
  const extractor = makeMockExtractor()
  mockedPipeline.mockResolvedValue(extractor as any)
  return buildLayer(
    makeConfigJson({
      embedder: { model: "Xenova/all-MiniLM-L6-v2", device: "cpu", dtype: "fp32", batchSize: 16 },
    }),
  )
}

const gpuFallbackLayer = (configDevice: "auto" | "cpu" = "auto") => {
  const extractor = makeMockExtractor()
  mockedPipeline
    .mockResolvedValueOnce(extractor as any)
    .mockRejectedValueOnce(new Error("cuda not available"))
    .mockResolvedValueOnce(extractor as any)
  return buildLayer(
    makeConfigJson({
      embedder: {
        model: "Xenova/all-MiniLM-L6-v2",
        device: configDevice,
        dtype: "fp32",
        batchSize: 16,
      },
    }),
  )
}

beforeEach(() => {
  mockedPipeline.mockReset()
})

describe("OnnxEmbedder GPU fallback", () => {
  test("loads directly on cpu without fallback when device is cpu", () => {
    const { layer } = defaultCpuLayer()

    return Effect.gen(function* () {
      const embedder = yield* Embedder
      const result = yield* embedder.embed("hello world")
      expect(result.dims).toBe(DIMS)
      expect(result.vector.length).toBe(DIMS)

      const fallback = yield* embedder.getFallbackInfo()
      expect(fallback).toBeUndefined()
    }).pipe(Effect.provide(layer), Effect.scoped)
  })

  test("falls back to cpu when gpu load fails and device is auto", () => {
    const { layer } = gpuFallbackLayer("auto")

    return Effect.gen(function* () {
      const embedder = yield* Embedder
      const result = yield* embedder.embed("hello world")
      expect(result.dims).toBe(DIMS)

      const fallback = yield* embedder.getFallbackInfo()
      expect(fallback).toBeDefined()
      expect(fallback!.originalDevice).toBe("cuda")
      expect(fallback!.reason).toContain("cuda")
    }).pipe(Effect.provide(layer), Effect.scoped)
  })

  test("logs warning when GPU fallback occurs", () => {
    const { ref, layer } = gpuFallbackLayer("auto")

    return Effect.gen(function* () {
      const embedder = yield* Embedder
      yield* embedder.embed("hello world")

      const entries = yield* Ref.get(ref)
      const logEntries = entries.filter((e) => e._tag === "log")
      const warnEntry = logEntries.find(
        (e) => e._tag === "log" && e.severity === "warn" && e.message.includes("falling back"),
      )
      expect(warnEntry).toBeDefined()
    }).pipe(Effect.provide(layer), Effect.scoped)
  })
})

describe("OnnxEmbedder createForDevice", () => {
  test("creates working embedder for cpu device", () => {
    const { layer } = defaultCpuLayer()

    return Effect.gen(function* () {
      const embedder = yield* Embedder
      const devCfg: EmbedderDeviceConfig = {
        device: "cpu",
        model: "Xenova/all-MiniLM-L6-v2",
        dtype: "fp32",
        dims: DIMS,
      }
      const bound = yield* embedder.createForDevice(devCfg)
      expect(bound).toBeDefined()

      const results = yield* bound.batch(["hello", "world"])
      expect(results.length).toBe(2)
      expect(results[0].dims).toBe(DIMS)
    }).pipe(Effect.provide(layer), Effect.scoped)
  })

  test("falls back to cpu when createForDevice gpu fails", () => {
    const { layer } = gpuFallbackLayer("cpu")

    return Effect.gen(function* () {
      const embedder = yield* Embedder
      const devCfg: EmbedderDeviceConfig = {
        device: "cuda",
        model: "Xenova/all-MiniLM-L6-v2",
        dtype: "fp32",
        dims: DIMS,
      }
      const bound = yield* embedder.createForDevice(devCfg)
      const results = yield* bound.batch(["test"])
      expect(results.length).toBe(1)
    }).pipe(Effect.provide(layer), Effect.scoped)
  })
})

describe("OnnxEmbedder config validation", () => {
  test("fails with ModelLoadError when model is unknown", () => {
    const extractor = makeMockExtractor()
    mockedPipeline.mockResolvedValue(extractor as any)
    const { layer } = buildLayer(
      makeConfigJson({
        embedder: { model: "unknown/model", device: "cpu", dtype: "fp32", batchSize: 16 },
      }),
    )

    return Effect.gen(function* () {
      const error = yield* Effect.flip(
        Effect.gen(function* () {
          const embedder = yield* Embedder
          yield* embedder.embed("test")
        }),
      )
      expect(error).toBeInstanceOf(ModelLoadError)
      expect((error as ModelLoadError).model).toBe("unknown/model")
    }).pipe(Effect.provide(layer), Effect.scoped)
  })

  test("fails with ModelLoadError when dtype is unsupported for model", () => {
    const extractor = makeMockExtractor()
    mockedPipeline.mockResolvedValue(extractor as any)
    const { layer } = buildLayer(
      makeConfigJson({
        embedder: { model: "Xenova/all-MiniLM-L6-v2", device: "cpu", dtype: "q4", batchSize: 16 },
      }),
    )

    return Effect.gen(function* () {
      const error = yield* Effect.flip(
        Effect.gen(function* () {
          const embedder = yield* Embedder
          yield* embedder.embed("test")
        }),
      )
      expect(error).toBeInstanceOf(ModelLoadError)
      expect((error as ModelLoadError).message).toContain("q4")
    }).pipe(Effect.provide(layer), Effect.scoped)
  })
})
