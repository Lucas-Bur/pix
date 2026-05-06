import { Effect, Layer } from "effect"

import type { Embedding } from "../domain/embedding.js"
import { Embedder } from "../domain/ports.js"
export { Embedder }

const makeMock = Effect.succeed({
  embed: (_text: string): Effect.Effect<Embedding, never> =>
    Effect.succeed({
      vector: new Float32Array(384).map(() => 1 / Math.sqrt(384)),
      dims: 384,
    }),

  batch: (texts: readonly string[]): Effect.Effect<readonly Embedding[], never> =>
    Effect.succeed(
      texts.map(() => ({
        vector: new Float32Array(384).map(() => 1 / Math.sqrt(384)),
        dims: 384,
      })),
    ),
} as const)

export const MockEmbedderLive = Layer.effect(Embedder, makeMock)
