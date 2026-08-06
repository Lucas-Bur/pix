import type { FeatureExtractionPipeline, Tensor } from "@huggingface/transformers"
import { Effect, Layer, Ref, Option, Result } from "effect"

import type { Embedding } from "../domain/chunk.js"
import type { DeviceType } from "../domain/device.js"
import type { EmbeddingDtype } from "../domain/dtype.js"
import { InferenceError, ModelLoadError, TokenLimitError } from "../domain/errors.js"
import { MODEL_REGISTRY } from "../domain/models.js"
import {
  ConfigStore,
  DeviceDetection,
  Display,
  Embedder,
  type EmbedderDeviceConfig,
  type BoundEmbedder,
  type EmbeddingLimits,
} from "../domain/ports.js"
import { resolveEmbedderConfig } from "../lib/embedder/resolve.js"
import { ConfigStoreLive } from "./config-store.js"
import { DeviceDetectionLive, loadFirstAvailableDevice } from "./device-detect.js"

const DEFAULT_TOKEN_LIMIT = 512
const DEFAULT_BATCH_SIZE = 16

interface FallbackInfo {
  readonly originalDevice: string
  readonly reason: string
}

/** Shared model and batch contract passed to embedding helpers. */
type EmbedBatchOptions = {
  readonly model: string
  readonly dims: number
  readonly dtype: EmbeddingDtype
  readonly hardTokenLimit: number
  readonly maxInputTokens: number
  readonly batchSize: number
}

/** Embedding contract plus the device used by the GPU fallback workflow. */
type GpuFallbackOptions = EmbedBatchOptions & {
  readonly device: DeviceType
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
  { model, dims, dtype, hardTokenLimit, maxInputTokens, batchSize }: EmbedBatchOptions,
): {
  readonly limits: EmbeddingLimits
  readonly countTokens: (text: string) => Effect.Effect<number, InferenceError>
  readonly embed: (text: string) => Effect.Effect<Embedding, InferenceError | TokenLimitError>
  readonly batch: (
    texts: readonly string[],
  ) => Effect.Effect<readonly Embedding[], InferenceError | TokenLimitError>
} => {
  const limits: EmbeddingLimits = {
    model,
    hardTokenLimit,
    maxInputTokens,
  }

  const countTokensWithExtractor = (extractor: FeatureExtractionPipeline, text: string) =>
    Effect.try({
      try: () =>
        extractor.tokenizer(text, {
          add_special_tokens: true,
          truncation: false,
          return_tensor: false,
        }).input_ids.length,
      catch: (cause) => new InferenceError({ message: "Dense tokenization failed", cause }),
    })

  const countTokens = (text: string) =>
    Effect.gen(function* () {
      const extractor = yield* getExtractor()
      return yield* countTokensWithExtractor(extractor, text)
    })

  const validateInput = (text: string, extractor: FeatureExtractionPipeline) =>
    Effect.gen(function* () {
      const tokens = yield* countTokensWithExtractor(extractor, text)
      if (tokens > limits.maxInputTokens) {
        return yield* new TokenLimitError({
          message: `Dense input for "${model}" has ${tokens} tokens; the maximum is ${limits.maxInputTokens}`,
          model,
          actualTokens: tokens,
          limit: limits.maxInputTokens,
          scope: "input",
        })
      }
      return tokens
    })

  const embed = (text: string) =>
    Effect.gen(function* () {
      const extractor = yield* getExtractor()
      yield* validateInput(text, extractor)
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
      if (texts.length === 0) return []
      if (texts.length > batchSize) {
        return yield* new TokenLimitError({
          message: `Dense batch for "${model}" has ${texts.length} inputs; the batch limit is ${batchSize}`,
          model,
          actualTokens: texts.length,
          limit: batchSize,
          scope: "batch",
        })
      }
      const extractor = yield* getExtractor()
      yield* Effect.forEach(texts, (text) => validateInput(text, extractor))
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

  return { limits, countTokens, embed, batch: batchEmbed }
}

/** Load one embedding model for an explicit device configuration. */
const createBoundEmbedder = (
  cfg: EmbedderDeviceConfig,
): Effect.Effect<BoundEmbedder, ModelLoadError> =>
  Effect.gen(function* () {
    const info = MODEL_REGISTRY[cfg.model]
    const hardTokenLimit = cfg.hardTokenLimit ?? info?.hardTokenLimit ?? DEFAULT_TOKEN_LIMIT
    const maxInputTokens = cfg.maxInputTokens ?? info?.maxInputTokens ?? DEFAULT_TOKEN_LIMIT
    if (maxInputTokens > hardTokenLimit) {
      return yield* new ModelLoadError({
        message: `Invalid token limits for "${cfg.model}": maxInputTokens (${maxInputTokens}) exceeds hardTokenLimit (${hardTokenLimit})`,
        model: cfg.model,
      })
    }
    const extractor = yield* loadExtractor(cfg.model, cfg.device, cfg.dtype)
    return makeEmbedBatch(() => Effect.succeed(extractor), {
      model: cfg.model,
      dims: cfg.dims,
      dtype: cfg.dtype,
      hardTokenLimit,
      maxInputTokens,
      batchSize: cfg.batchSize ?? DEFAULT_BATCH_SIZE,
    })
  })

/** Embedding model loaded on the first working device in automatic priority order. */
export interface AutoBoundEmbedder {
  readonly device: DeviceType
  readonly embedder: BoundEmbedder
}

/** Load an embedding model once on the highest-priority working device. */
export const createAutoBoundEmbedder = (cfg: {
  readonly model: string
  readonly dtype: EmbeddingDtype
  readonly dims: number
  readonly batchSize?: number
}): Effect.Effect<AutoBoundEmbedder, ModelLoadError> =>
  Effect.gen(function* () {
    const info = MODEL_REGISTRY[cfg.model]
    if (!info) {
      return yield* new ModelLoadError({
        message: `Unknown embedding model "${cfg.model}"`,
        model: cfg.model,
      })
    }
    return yield* loadFirstAvailableDevice(cfg.model, (device) =>
      createBoundEmbedder({
        ...cfg,
        device,
        hardTokenLimit: info.hardTokenLimit,
        maxInputTokens: info.maxInputTokens,
        batchSize: cfg.batchSize ?? DEFAULT_BATCH_SIZE,
      }),
    )
  }).pipe(Effect.map(({ device, value }) => ({ device, embedder: value })))

const withGpuFallback = (
  { device, ...options }: GpuFallbackOptions,
  d: typeof Display.Service,
  fallbackRef: Ref.Ref<Option.Option<FallbackInfo>>,
): Effect.Effect<BoundEmbedder, ModelLoadError> =>
  Effect.gen(function* () {
    if (device === "cpu") {
      const extractor = yield* loadExtractor(options.model, device, options.dtype)
      const getExtractor = yield* Effect.succeed(() => Effect.succeed(extractor))
      return makeEmbedBatch(getExtractor, options)
    }

    const gpuResult = yield* loadExtractor(options.model, device, options.dtype).pipe(Effect.result)
    if (Result.isSuccess(gpuResult)) {
      const getExtractor = yield* Effect.succeed(() => Effect.succeed(gpuResult.success))
      return makeEmbedBatch(getExtractor, options)
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

    const cpuExtractor = yield* loadExtractor(options.model, "cpu", options.dtype)
    const getCpuExtractor = yield* Effect.succeed(() => Effect.succeed(cpuExtractor))
    return makeEmbedBatch(getCpuExtractor, options)
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
      hardTokenLimit: MODEL_REGISTRY[resolved.model]!.hardTokenLimit,
      maxInputTokens: MODEL_REGISTRY[resolved.model]!.maxInputTokens,
      batchSize: config?.embedder.batchSize ?? DEFAULT_BATCH_SIZE,
    }
  })

const make = Effect.gen(function* () {
  const configStore = yield* ConfigStore
  const detection = yield* DeviceDetection
  const d = yield* Display
  const cfg = yield* resolveEmbedderDeviceConfig(configStore, detection)
  const fallbackRef = yield* Ref.make<Option.Option<FallbackInfo>>(Option.none())
  const bound = yield* withGpuFallback(
    {
      model: cfg.model,
      device: cfg.device,
      dtype: cfg.dtype,
      dims: cfg.dims,
      hardTokenLimit: cfg.hardTokenLimit ?? DEFAULT_TOKEN_LIMIT,
      maxInputTokens: cfg.maxInputTokens ?? DEFAULT_TOKEN_LIMIT,
      batchSize: cfg.batchSize ?? DEFAULT_BATCH_SIZE,
    },
    d,
    fallbackRef,
  )
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

  const countTokens = (text: string) =>
    Effect.gen(function* () {
      const b = yield* getExtractor
      return yield* b.countTokens(text)
    })

  const getFallbackInfo = () =>
    Ref.get(fallbackRef).pipe(Effect.map(Option.getOrElse(() => undefined)))

  const createForDevice = createBoundEmbedder

  return {
    limits: bound.limits,
    countTokens,
    embed,
    batch: batchEmbed,
    getFallbackInfo,
    createForDevice,
  } as const
})

export const OnnxEmbedderLive = Layer.provideMerge(
  Layer.effect(Embedder, make),
  Layer.merge(ConfigStoreLive, DeviceDetectionLive),
)
