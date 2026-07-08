import type { FeatureExtractionPipeline, Tensor } from "@huggingface/transformers"
import { Effect, Layer, Ref, Option, Result } from "effect"

import type { Embedding } from "../domain/chunk.js"
import type { DeviceType } from "../domain/device.js"
import type { EmbeddingDtype } from "../domain/dtype.js"
import { InferenceError, ModelLoadError } from "../domain/errors.js"
import { MODEL_REGISTRY } from "../domain/models.js"
import {
  ConfigStore,
  DeviceDetection,
  Display,
  Embedder,
  type EmbedderDeviceConfig,
  type BoundEmbedder,
} from "../domain/ports.js"
import { resolveEmbedderConfig } from "../lib/embedder/resolve.js"
import { ConfigStoreLive } from "./config-store.js"
import { DeviceDetectionLive } from "./device-detect.js"

interface FallbackInfo {
  readonly originalDevice: string
  readonly reason: string
}

/**
 * Extract Float32Array from inference tensor.
 *
 * IMPORTANT: The `dtype` config (`fp32`, `fp16`, `q8`, `q4`) controls model weight precision, NOT
 * output activation dtype. FeatureExtractionPipeline always returns `tensor.type: "float32"` with
 * `tensor.data` as `Float32Array`, regardless of weight dtype. Quantization is applied to weights
 * only; the forward pass still produces float32 embeddings.
 *
 * See ADR-0008 for the experimental verification across fp32/q8/q4 weight dtypes.
 */
const extractF32Data = (tensor: Tensor): Float32Array => tensor.data as Float32Array

const loadExtractor = (
  model: string,
  device: DeviceType,
  dtype: EmbeddingDtype,
): Effect.Effect<FeatureExtractionPipeline, ModelLoadError> =>
  Effect.tryPromise(async () => {
    const { pipeline } = await import("@huggingface/transformers")
    return await pipeline("feature-extraction", model, { device, dtype })
  }).pipe(
    Effect.mapError(
      (cause) =>
        new ModelLoadError({
          message: `Failed to load embedding model "${model}" on device "${device}"`,
          model,
          cause,
        }),
    ),
  )

const makeEmbedBatch = (
  getExtractor: () => Effect.Effect<FeatureExtractionPipeline, never, never>,
  dims: number,
  dtype: EmbeddingDtype,
): {
  embed: (text: string) => Effect.Effect<Embedding, InferenceError>
  batch: (texts: readonly string[]) => Effect.Effect<readonly Embedding[], InferenceError>
} => {
  const embed = (text: string) =>
    Effect.gen(function* () {
      const extractor = yield* getExtractor()
      const tensor = yield* Effect.tryPromise(() =>
        extractor(text, { pooling: "mean", normalize: false }),
      ).pipe(
        Effect.mapError(
          (cause) => new InferenceError({ message: "Embedding inference failed", cause }),
        ),
      )
      const vector = extractF32Data(tensor)
      return { vector, dims, dtype }
    })

  const batchEmbed = (texts: readonly string[]) =>
    Effect.gen(function* () {
      const extractor = yield* getExtractor()
      const tensor = yield* Effect.tryPromise(() =>
        extractor([...texts], { pooling: "mean", normalize: false }),
      ).pipe(
        Effect.mapError(
          (cause) => new InferenceError({ message: "Batch embedding inference failed", cause }),
        ),
      )
      const data = extractF32Data(tensor)
      const n = tensor.dims[0]
      const results: Embedding[] = []
      for (let j = 0; j < n; j++) {
        const offset = j * dims
        results.push({
          vector: data.slice(offset, offset + dims),
          dims,
          dtype,
        })
      }
      return results
    })

  return { embed, batch: batchEmbed }
}

const withGpuFallback = (
  model: string,
  device: DeviceType,
  dtype: EmbeddingDtype,
  dims: number,
  d: typeof Display.Service,
  fallbackRef: Ref.Ref<Option.Option<FallbackInfo>>,
): Effect.Effect<BoundEmbedder, ModelLoadError> =>
  Effect.gen(function* () {
    if (device === "cpu") {
      const extractor = yield* loadExtractor(model, device, dtype)
      const getExtractor = yield* Effect.succeed(() => Effect.succeed(extractor))
      return makeEmbedBatch(getExtractor, dims, dtype)
    }

    const gpuResult = yield* loadExtractor(model, device, dtype).pipe(Effect.result)
    if (Result.isSuccess(gpuResult)) {
      const getExtractor = yield* Effect.succeed(() => Effect.succeed(gpuResult.success))
      return makeEmbedBatch(getExtractor, dims, dtype)
    }

    const originalError = gpuResult.failure
    yield* d.log(`GPU (${device}) failed, falling back to CPU...`, "warn")
    yield* Ref.set(
      fallbackRef,
      Option.some({
        originalDevice: device,
        reason: originalError.message,
      }),
    )

    const cpuExtractor = yield* loadExtractor(model, "cpu", dtype)
    const getCpuExtractor = yield* Effect.succeed(() => Effect.succeed(cpuExtractor))
    return makeEmbedBatch(getCpuExtractor, dims, dtype)
  })

const resolveEmbedderDeviceConfig = (
  configStore: typeof ConfigStore.Service,
  detection: typeof DeviceDetection.Service,
): Effect.Effect<EmbedderDeviceConfig, ModelLoadError> =>
  Effect.gen(function* () {
    const resolved = yield* resolveEmbedderConfig(configStore)
    const supportedDtypes = MODEL_REGISTRY[resolved.model]?.dtypes ?? []
    if (!supportedDtypes.includes(resolved.dtype)) {
      return yield* new ModelLoadError({
        message: `Unsupported dtype "${resolved.dtype}" for model "${resolved.model}". Supported: ${supportedDtypes.join(", ")}`,
        model: resolved.model,
      })
    }

    const config = yield* configStore
      .readConfig()
      .pipe(Effect.catch(() => Effect.succeed(undefined)))
    const deviceConfig = config?.embedder.device ?? "auto"
    const device =
      deviceConfig === "auto"
        ? yield* detection.detect(resolved.model, resolved.dtype)
        : deviceConfig

    return {
      model: resolved.model,
      device,
      dtype: resolved.dtype,
      dims: resolved.dims,
    }
  })

const make = Effect.gen(function* () {
  const configStore = yield* ConfigStore
  const detection = yield* DeviceDetection
  const d = yield* Display
  const cfg = yield* resolveEmbedderDeviceConfig(configStore, detection)
  const fallbackRef = yield* Ref.make<Option.Option<FallbackInfo>>(Option.none())
  const bound = yield* withGpuFallback(cfg.model, cfg.device, cfg.dtype, cfg.dims, d, fallbackRef)
  const getExtractor = yield* Effect.cached(Effect.succeed(bound))

  const embed = (text: string) =>
    Effect.gen(function* () {
      const b = yield* getExtractor
      return yield* b.embed(text)
    })

  const batchEmbed = (texts: readonly string[]) =>
    Effect.gen(function* () {
      const b = yield* getExtractor
      return yield* b.batch(texts)
    })

  const getFallbackInfo = () =>
    Ref.get(fallbackRef).pipe(Effect.map(Option.getOrElse(() => undefined)))

  const createForDevice = (devCfg: EmbedderDeviceConfig) =>
    Effect.gen(function* () {
      const extractor = yield* loadExtractor(devCfg.model, devCfg.device, devCfg.dtype)
      const getExtractor = () => Effect.succeed(extractor)
      return makeEmbedBatch(getExtractor, devCfg.dims, devCfg.dtype)
    })

  return { embed, batch: batchEmbed, getFallbackInfo, createForDevice } as const
})

export const OnnxEmbedderLive = Layer.provideMerge(
  Layer.effect(Embedder, make),
  Layer.merge(ConfigStoreLive, DeviceDetectionLive),
)
