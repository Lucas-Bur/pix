import { type DataType } from "@huggingface/transformers"
import { Effect, Layer, Ref, Option } from "effect"

import type { Embedding } from "../domain/chunk.js"
import type { EmbeddingDtype } from "../domain/dtype.js"
import { InferenceError, ModelLoadError } from "../domain/errors.js"
import { ConfigStore, Display, Embedder } from "../domain/ports.js"
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

    const device =
      deviceConfig === "auto" ? yield* detection.detect(model, dtype as DataType) : deviceConfig

    return { model, device, dtype, dims: modelInfo.dims }
  })

const createExtractor = (opts: EmbedderConfig) =>
  Effect.tryPromise(async () => {
    const { pipeline } = await import("@huggingface/transformers")
    return pipeline("feature-extraction", opts.model, {
      device: opts.device,
      dtype: opts.dtype,
    })
  }).pipe(
    Effect.mapError(
      (cause) =>
        new ModelLoadError({
          message: `Failed to load embedding model with device "${opts.device}"`,
          model: opts.model,
          cause,
        }),
    ),
  )

const createExtractorWithFallback = (
  opts: EmbedderConfig,
  fallbackRef: Ref.Ref<Option.Option<FallbackInfo>>,
  d: typeof Display.Service,
) => {
  if (opts.device === "cpu") return createExtractor(opts)

  return createExtractor(opts).pipe(
    Effect.catchAll((originalError) =>
      Effect.gen(function* () {
        yield* d.log(`GPU (${opts.device}) failed, falling back to CPU...`, "warn")
        yield* Ref.set(
          fallbackRef,
          Option.some({
            originalDevice: opts.device,
            reason: originalError.message,
          }),
        )
        const cpuOpts: EmbedderConfig = { ...opts, device: "cpu" }
        const fallback = yield* createExtractor(cpuOpts).pipe(
          Effect.catchAll(() => Effect.fail(originalError)),
        )
        return fallback
      }),
    ),
  )
}

const make = Effect.gen(function* () {
  const configStore = yield* ConfigStore
  const detection = yield* DeviceDetection
  const d = yield* Display
  const cfg = yield* resolveEmbedderConfig(configStore, detection)
  const fallbackRef = yield* Ref.make<Option.Option<FallbackInfo>>(Option.none())
  const getExtractor = yield* Effect.cached(createExtractorWithFallback(cfg, fallbackRef, d))

  const embed = (text: string) =>
    Effect.gen(function* () {
      const extractor = yield* getExtractor
      const tensor = yield* Effect.tryPromise(() =>
        extractor(text, { pooling: "mean", normalize: false }),
      ).pipe(
        Effect.mapError(
          (cause) => new InferenceError({ message: "Embedding inference failed", cause }),
        ),
      )
      const data = tensor.data as Float32Array
      return { vector: data, dims: cfg.dims, dtype: cfg.dtype }
    })

  const batch = (texts: readonly string[]) =>
    Effect.gen(function* () {
      const extractor = yield* getExtractor
      const tensor = yield* Effect.tryPromise(() =>
        extractor([...texts], { pooling: "mean", normalize: false }),
      ).pipe(
        Effect.mapError(
          (cause) => new InferenceError({ message: "Batch embedding inference failed", cause }),
        ),
      )
      const data = tensor.data as Float32Array
      const n = tensor.dims[0]
      const results: Embedding[] = []
      for (let j = 0; j < n; j++) {
        const offset = j * cfg.dims
        results.push({
          vector: data.slice(offset, offset + cfg.dims),
          dims: cfg.dims,
          dtype: cfg.dtype,
        })
      }
      return results
    })

  const getFallbackInfo = () =>
    Ref.get(fallbackRef).pipe(Effect.map(Option.getOrElse(() => undefined)))

  return { embed, batch, getFallbackInfo } as const
})

export const OnnxEmbedderLive = Layer.provideMerge(
  Layer.effect(Embedder, make),
  Layer.merge(ConfigStoreLive, DeviceDetectionLive),
)
