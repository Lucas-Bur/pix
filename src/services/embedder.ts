import { env } from "@huggingface/transformers"
import { Effect, Layer, Ref, Option } from "effect"

import { Display } from "../display/Display.js"
import type { Embedding } from "../domain/chunk.js"
import { InferenceError, ModelLoadError } from "../domain/errors.js"
import { MODEL_REGISTRY } from "../domain/models.js"
import { ConfigStore, Embedder } from "../domain/ports.js"
import { ConfigStoreLive } from "./config-store.js"
export { Embedder }

const CACHE_DIR = ".pix/cache"

env.cacheDir = CACHE_DIR

const normalize = (arr: Float32Array): Float32Array => {
  let norm = 0
  for (let i = 0; i < arr.length; i++) {
    norm += arr[i] * arr[i]
  }
  norm = Math.sqrt(norm)
  if (norm === 0) return arr
  const result = new Float32Array(arr.length)
  for (let i = 0; i < arr.length; i++) {
    result[i] = arr[i] / norm
  }
  return result
}

interface EmbedderConfig {
  readonly model: string
  readonly device: "auto" | "cpu" | "cuda" | "dml" | "coreml"
  readonly dtype: "fp32" | "fp16" | "q8"
  readonly dims: number
}

interface FallbackInfo {
  readonly originalDevice: string
  readonly reason: string
}

const resolveEmbedderConfig = (
  configStore: typeof ConfigStore.Service,
): Effect.Effect<EmbedderConfig, ModelLoadError> =>
  Effect.gen(function* () {
    const config = yield* configStore
      .readConfig()
      .pipe(Effect.catchAll(() => Effect.succeed(undefined)))

    const model = config?.embedder.model ?? "Xenova/all-MiniLM-L6-v2"
    const device = config?.embedder.device ?? "auto"
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
) => {
  if (opts.device === "cpu") return createExtractor(opts)

  return createExtractor(opts).pipe(
    Effect.catchAll((originalError) =>
      Effect.gen(function* () {
        const d = yield* Display
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
  const d = yield* Display
  const cfg = yield* resolveEmbedderConfig(configStore)
  const fallbackRef = yield* Ref.make<Option.Option<FallbackInfo>>(Option.none())
  const getExtractor = yield* Effect.cached(createExtractorWithFallback(cfg, fallbackRef))

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
      return { vector: normalize(data), dims: cfg.dims }
    }).pipe(Effect.provideService(Display, d))

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
        results.push({ vector: normalize(data.slice(offset, offset + cfg.dims)), dims: cfg.dims })
      }
      return results
    }).pipe(Effect.provideService(Display, d))

  const getFallbackInfo = () =>
    Ref.get(fallbackRef).pipe(Effect.map(Option.getOrElse(() => undefined)))

  return { embed, batch, getFallbackInfo } as const
})

export const OnnxEmbedderLive = Layer.provideMerge(Layer.effect(Embedder, make), ConfigStoreLive)
