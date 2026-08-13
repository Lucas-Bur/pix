import { beforeEach, describe, expect, it } from "@effect/vitest"
import { Effect, Exit, Layer, Ref } from "effect"
import { vi } from "vitest"

import { makeConfigJson } from "../../tests/test-utils/fixtures.js"
import { memoryFsLayer } from "../../tests/test-utils/memfs.js"
import { silentDisplay } from "../../tests/test-utils/silentDisplay.js"
import { InferenceError, ModelLoadError } from "../domain/errors.js"
import type { EmbedderDeviceConfig } from "../domain/ports.js"
import { Embedder } from "../domain/ports.js"
import { createAutoBoundEmbedder, OnnxEmbedderLive } from "./embedder.js"

const DIMS = 384

type MockExtractor = ((input: string | string[]) => Promise<{
  data: Float32Array
  dims: number[]
}>) & {
  tokenizer: (input: string | string[]) => { input_ids: { length: number } }
}

type MockPipeline = (
  task: string,
  model: string,
  options: { device: string; dtype: string },
) => Promise<MockExtractor>

const { mockedPipeline } = vi.hoisted(() => ({
  mockedPipeline: vi.fn<MockPipeline>(),
}))

vi.mock("@huggingface/transformers", () => ({
  pipeline: mockedPipeline,
  env: { cacheDir: ".pix/cache" },
}))

const makeMockExtractor = (): MockExtractor => {
  const fn = vi.fn((input: string | string[]) => {
    const n = Array.isArray(input) ? input.length : 1
    return Promise.resolve({ data: new Float32Array(n * DIMS), dims: [n, DIMS] })
  })
  return Object.assign(fn, {
    tokenizer: (input: string | string[]) => ({
      input_ids: { length: Array.isArray(input) ? input.length : input.split(/\s+/u).length + 2 },
    }),
  })
}

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
  mockedPipeline.mockResolvedValue(extractor)
  return buildLayer(
    makeConfigJson({
      embedder: { model: "Xenova/all-MiniLM-L6-v2", device: "cpu", dtype: "fp32", batchSize: 16 },
    }),
  )
}

const gpuFallbackLayer = (configDevice: "auto" | "cpu" = "auto") => {
  const extractor = makeMockExtractor()
  mockedPipeline
    .mockResolvedValueOnce(extractor)
    .mockRejectedValueOnce(new Error("cuda not available"))
    .mockResolvedValueOnce(extractor)
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
  it.effect("loads directly on cpu without fallback when device is cpu", () => {
    const { layer } = defaultCpuLayer()

    return Effect.gen(function* () {
      const embedder = yield* Embedder
      const result = yield* embedder.embed("hello world")
      expect(result.dims).toBe(DIMS)
      expect(result.vector.length).toBe(DIMS)

      const fallback = yield* embedder.getFallbackInfo
      expect(fallback).toBeUndefined()
    }).pipe(Effect.provide(layer), Effect.scoped)
  })

  it.effect("falls back to cpu when gpu load fails and device is auto", () => {
    const { layer } = gpuFallbackLayer("auto")

    return Effect.gen(function* () {
      const embedder = yield* Embedder
      const result = yield* embedder.embed("hello world")
      expect(result.dims).toBe(DIMS)

      const fallback = yield* embedder.getFallbackInfo
      expect(fallback).toBeDefined()
      expect(fallback!.originalDevice).toBe("cuda")
      expect(fallback!.reason).toContain("cuda")
    }).pipe(Effect.provide(layer), Effect.scoped)
  })

  it.effect("logs warning when GPU fallback occurs", () => {
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

  it.effect("returns a model-load error when every automatic device fails", () => {
    mockedPipeline.mockRejectedValue(new Error("device unavailable"))

    return Effect.gen(function* () {
      const error = yield* Effect.flip(
        createAutoBoundEmbedder({
          model: "Xenova/all-MiniLM-L6-v2",
          dtype: "fp32",
          dims: DIMS,
        }),
      )
      expect(error).toBeInstanceOf(ModelLoadError)
    })
  })
})

describe("OnnxEmbedder inference errors", () => {
  it.effect("wraps single and batch inference failures", () => {
    const extractor = Object.assign(
      vi.fn((input: string | string[]) =>
        Promise.reject(new Error(Array.isArray(input) ? "batch failed" : "single failed")),
      ),
      { tokenizer: () => ({ input_ids: { length: 1 } }) },
    )
    mockedPipeline.mockResolvedValue(extractor)
    const { layer } = buildLayer(
      makeConfigJson({
        embedder: { model: "Xenova/all-MiniLM-L6-v2", device: "cpu", dtype: "fp32", batchSize: 16 },
      }),
    )

    return Effect.gen(function* () {
      const embedder = yield* Embedder
      const singleError = yield* Effect.flip(embedder.embed("single"))
      const batchError = yield* Effect.flip(embedder.batch(["one", "two"]))
      expect(singleError).toBeInstanceOf(InferenceError)
      expect(batchError).toBeInstanceOf(InferenceError)
    }).pipe(Effect.provide(layer), Effect.scoped)
  })
})

describe("OnnxEmbedder createForDevice", () => {
  it.effect("creates working embedder for cpu device", () => {
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

  it.effect("fails when createForDevice gpu is unavailable", () => {
    const { layer } = gpuFallbackLayer("cpu")

    return Effect.gen(function* () {
      const embedder = yield* Embedder
      const devCfg: EmbedderDeviceConfig = {
        device: "cuda",
        model: "Xenova/all-MiniLM-L6-v2",
        dtype: "fp32",
        dims: DIMS,
      }
      const error = yield* Effect.flip(embedder.createForDevice(devCfg))
      expect(error).toBeInstanceOf(ModelLoadError)
    }).pipe(Effect.provide(layer), Effect.scoped)
  })
})

describe("OnnxEmbedder config validation", () => {
  it.effect("passes an unknown model through to the pipeline", () => {
    const extractor = makeMockExtractor()
    mockedPipeline.mockResolvedValue(extractor)
    const { layer } = buildLayer(
      makeConfigJson({
        embedder: { model: "unknown/model", device: "cpu", dtype: "fp32", batchSize: 16 },
      }),
    )

    return Effect.gen(function* () {
      const exit = yield* Effect.exit(
        Effect.gen(function* () {
          const embedder = yield* Embedder
          yield* embedder.embed("test")
        }).pipe(Effect.provide(layer), Effect.scoped),
      )
      expect(Exit.isSuccess(exit)).toBe(true)
    })
  })

  it.effect("passes the configured dtype through to the pipeline", () => {
    const extractor = makeMockExtractor()
    mockedPipeline.mockResolvedValue(extractor)
    const { layer } = buildLayer(
      makeConfigJson({
        embedder: { model: "Xenova/all-MiniLM-L6-v2", device: "cpu", dtype: "q4", batchSize: 16 },
      }),
    )

    return Effect.gen(function* () {
      const exit = yield* Effect.exit(
        Effect.gen(function* () {
          const embedder = yield* Embedder
          yield* embedder.embed("test")
        }).pipe(Effect.provide(layer), Effect.scoped),
      )
      expect(Exit.isSuccess(exit)).toBe(true)
    })
  })
})
