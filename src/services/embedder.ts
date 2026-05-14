import { env } from "@huggingface/transformers"
import { Effect, Layer } from "effect"

import type { Embedding } from "../domain/embedding.js"
import { InferenceError, ModelLoadError } from "../domain/errors.js"
import { Embedder } from "../domain/ports.js"
export { Embedder }

const MODEL_NAME = "Xenova/all-MiniLM-L6-v2"
const DIMS = 384
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

const make = Effect.gen(function* () {
  const getExtractor = yield* Effect.cached(
    Effect.tryPromise(async () => {
      const { pipeline } = await import("@huggingface/transformers")
      return pipeline("feature-extraction", MODEL_NAME, {
        device: "cpu",
        dtype: "q8",
      })
    }).pipe(
      Effect.mapError(
        (cause) =>
          new ModelLoadError({
            message: `Failed to load embedding model`,
            model: MODEL_NAME,
            cause,
          }),
      ),
    ),
  )

  const embed = (text: string): Effect.Effect<Embedding, ModelLoadError | InferenceError> =>
    Effect.gen(function* () {
      const extractor = yield* getExtractor
      const tensor = yield* Effect.tryPromise(() =>
        extractor(text, { pooling: "mean", normalize: false }),
      ).pipe(
        Effect.mapError(
          (cause) =>
            new InferenceError({
              message: `Embedding inference failed`,
              cause,
            }),
        ),
      )
      const data = tensor.data as Float32Array
      return { vector: normalize(data), dims: DIMS }
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
            (cause) =>
              new InferenceError({
                message: `Batch embedding inference failed`,
                cause,
              }),
          ),
        )
        const data = tensor.data as Float32Array
        const n = tensor.dims[0]
        for (let j = 0; j < n; j++) {
          const offset = j * DIMS
          results.push(normalize(data.slice(offset, offset + DIMS)))
        }
      }
      return results.map((vector) => ({ vector, dims: DIMS }))
    })

  return { embed, batch } as const
})

export const OnnxEmbedderLive = Layer.effect(Embedder, make)
