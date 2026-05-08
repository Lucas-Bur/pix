import { env } from "@huggingface/transformers"
import { Effect, Layer } from "effect"

import type { Embedding } from "../domain/embedding.js"
import { Embedder } from "../domain/ports.js"
export { Embedder }

const MODEL_NAME = "Xenova/all-MiniLM-L6-v2"
const DIMS = 384
const CACHE_DIR = ".pix/cache"
const BATCH_SIZE = 16

// Configure model cache location
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

const make = Effect.gen(function* () {
  // Lazy: import + model load are deferred until first embed/batch call.
  // Effect.cached ensures the pipeline is only initialized once per invocation,
  // even if embed/batch are called concurrently.
  const getExtractor = yield* Effect.cached(
    Effect.tryPromise(async () => {
      const { pipeline } = await import("@huggingface/transformers")
      return pipeline("feature-extraction", MODEL_NAME, {
        device: "cpu",
        dtype: "q8",
      })
    }),
  )

  const embed = (text: string): Effect.Effect<Embedding, never> =>
    Effect.gen(function* () {
      const extractor = yield* getExtractor
      const tensor = yield* Effect.tryPromise(() =>
        extractor(text, { pooling: "mean", normalize: false }),
      )
      const data = tensor.data as Float32Array
      return { vector: normalize(data), dims: DIMS }
    }).pipe(
      Effect.catchAll(() =>
        Effect.succeed({
          vector: new Float32Array(DIMS),
          dims: DIMS,
        }),
      ),
    )

  const batch = (texts: readonly string[]): Effect.Effect<readonly Embedding[], never> =>
    Effect.gen(function* () {
      const extractor = yield* getExtractor
      const results: Float32Array[] = []
      for (let i = 0; i < texts.length; i += BATCH_SIZE) {
        const slice = texts.slice(i, i + BATCH_SIZE)
        const tensor = yield* Effect.tryPromise(() =>
          extractor(slice, { pooling: "mean", normalize: false }),
        )
        const data = tensor.data as Float32Array
        const n = tensor.dims[0]
        for (let j = 0; j < n; j++) {
          const offset = j * DIMS
          results.push(normalize(data.slice(offset, offset + DIMS)))
        }
      }
      return results.map((vector) => ({ vector, dims: DIMS }))
    }).pipe(Effect.catchAll(() => Effect.succeed([])))

  return { embed, batch } as const
})

export const OnnxEmbedderLive = Layer.effect(Embedder, make)
