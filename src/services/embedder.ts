import { env } from "@huggingface/transformers"
import { Effect, Layer } from "effect"

import type { Embedding } from "../domain/embedding.js"
import { InferenceError, ModelLoadError } from "../domain/errors.js"
import { MODEL_REGISTRY } from "../domain/models.js"
import { ConfigStore, Embedder } from "../domain/ports.js"
import { ConfigStoreLive } from "./config-store.js"
export { Embedder }

const CACHE_DIR = ".pix/cache"
const BATCH_SIZE = 16

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
          message: "Failed to load embedding model",
          model: opts.model,
          cause,
        }),
    ),
  )

const make = Effect.gen(function* () {
  const configStore = yield* ConfigStore
  const cfg = yield* resolveEmbedderConfig(configStore)
  const getExtractor = yield* Effect.cached(createExtractor(cfg))

  const embed = (text: string): Effect.Effect<Embedding, ModelLoadError | InferenceError> =>
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
    })

  const batch = (
    texts: readonly string[],
  ): Effect.Effect<readonly Embedding[], ModelLoadError | InferenceError> =>
    Effect.gen(function* () {
      const extractor = yield* getExtractor
      const results: Float32Array[] = []
      for (let i = 0; i < texts.length; i += BATCH_SIZE) {
        const slice = texts.slice(i, i + BATCH_SIZE)
        const tensor = yield* Effect.tryPromise(() =>
          extractor(slice, { pooling: "mean", normalize: false }),
        ).pipe(
          Effect.mapError(
            (cause) => new InferenceError({ message: "Batch embedding inference failed", cause }),
          ),
        )
        const data = tensor.data as Float32Array
        const n = tensor.dims[0]
        for (let j = 0; j < n; j++) {
          const offset = j * cfg.dims
          results.push(normalize(data.slice(offset, offset + cfg.dims)))
        }
      }
      return results.map((vector) => ({ vector, dims: cfg.dims }))
    })

  return { embed, batch } as const
})

export const OnnxEmbedderLive = Layer.provideMerge(Layer.effect(Embedder, make), ConfigStoreLive)
