import { Effect, Layer, Ref, Option } from "effect"

import type { Embedding } from "../domain/chunk.js"
import type { EmbeddingDtype } from "../domain/dtype.js"
import { InferenceError, ModelLoadError } from "../domain/errors.js"
import {
  ConfigStore,
  Display,
  Embedder,
  type EmbedderDeviceConfig,
  type BoundEmbedder,
} from "../domain/ports.js"
import { ConfigStoreLive } from "./config-store.js"
import { DeviceDetection, DeviceDetectionLive } from "./device-detect.js"
import type { DeviceType } from "./device-detect.js"
import { MODEL_REGISTRY } from "./models.js"
export { Embedder }

interface EmbedderConfig {
  readonly model: string
  readonly device: DeviceType
  readonly dtype: EmbeddingDtype
  readonly dims: number
}

interface FallbackInfo {
  readonly originalDevice: string
  readonly reason: string
}

type Extractor = (
  texts: string | string[],
  opts: { pooling: string; normalize: boolean },
) => Promise<{
  data: Float32Array
  dims: number[]
}>

const loadExtractor = (
  model: string,
  device: string,
  dtype: string,
): Effect.Effect<Extractor, ModelLoadError> =>
  Effect.tryPromise(async () => {
    const { pipeline } = await import("@huggingface/transformers")
    return (await pipeline("feature-extraction", model, {
      device,
      dtype,
    } as any)) as Extractor
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
  getExtractor: () => Effect.Effect<Extractor, never, never>,
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
      return { vector: tensor.data, dims, dtype } as Embedding
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
      const data = tensor.data
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
  device: string,
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

    const gpuResult = yield* loadExtractor(model, device, dtype).pipe(Effect.either)
    if (gpuResult._tag === "Right") {
      const getExtractor = yield* Effect.succeed(() => Effect.succeed(gpuResult.right))
      return makeEmbedBatch(getExtractor, dims, dtype)
    }

    const originalError = gpuResult.left
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

const resolveEmbedderConfig = (
  configStore: typeof ConfigStore.Service,
  detection: typeof DeviceDetection.Service,
): Effect.Effect<EmbedderConfig, ModelLoadError> =>
  Effect.gen(function* () {
    const config = yield* configStore
      .readConfig()
      .pipe(Effect.catchAll(() => Effect.succeed(undefined)))

    const model = config?.embedder.model ?? "Xenova/all-MiniLM-L6-v2"
    const deviceConfig = config?.embedder.device ?? "auto"
    const dtype = config?.embedder.dtype ?? "fp32"

    const modelInfo = MODEL_REGISTRY[model]
    if (!modelInfo) {
      return yield* new ModelLoadError({
        message: `Unknown embedding model "${model}". Available: ${Object.keys(MODEL_REGISTRY).join(", ")}`,
        model,
      })
    }

    if (!modelInfo.dtypes.includes(dtype)) {
      return yield* new ModelLoadError({
        message: `Unsupported dtype "${dtype}" for model "${model}". Supported: ${modelInfo.dtypes.join(", ")}`,
        model,
      })
    }

    const device = deviceConfig === "auto" ? yield* detection.detect(model, dtype) : deviceConfig

    return { model, device, dtype, dims: modelInfo.dims }
  })

const make = Effect.gen(function* () {
  const configStore = yield* ConfigStore
  const detection = yield* DeviceDetection
  const d = yield* Display
  const cfg = yield* resolveEmbedderConfig(configStore, detection)
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
    withGpuFallback(
      devCfg.model,
      devCfg.device,
      devCfg.dtype as EmbeddingDtype,
      devCfg.dims,
      d,
      fallbackRef,
    )

  return { embed, batch: batchEmbed, getFallbackInfo, createForDevice } as const
})

export const OnnxEmbedderLive = Layer.provideMerge(
  Layer.effect(Embedder, make),
  Layer.merge(ConfigStoreLive, DeviceDetectionLive),
)
