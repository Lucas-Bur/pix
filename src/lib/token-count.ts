import { Effect } from "effect"

import type { InferenceError, ModelLoadError } from "../domain/errors.js"
import { resolveChunkTokenLimit } from "../domain/models.js"
import type { EmbeddingLimits } from "../domain/ports.js"

type TokenCounter = (text: string) => Effect.Effect<number, ModelLoadError | InferenceError>

type TokenAwareEmbedder = {
  readonly limits: EmbeddingLimits
  readonly countTokens: TokenCounter
}

/** Create a cached counter that uses the larger count from the active Dense and Sparse tokenizers. */
export const createCombinedTokenCounter = (
  dense: TokenCounter,
  sparse: TokenCounter,
): TokenCounter => {
  const counts = new Map<string, number>()

  return (text: string) => {
    const cached = counts.get(text)
    if (cached !== undefined) return Effect.succeed(cached)
    return Effect.all([dense(text), sparse(text)]).pipe(
      Effect.map(([denseCount, sparseCount]) => {
        const count = Math.max(denseCount, sparseCount)
        counts.set(text, count)
        return count
      }),
    )
  }
}

/** Resolve the shared chunk cap and tokenizer counter used by Dense and Sparse chunk preparation. */
export const createTokenAwareChunking = (
  configuredChunkTokens: number | undefined,
  dense: TokenAwareEmbedder,
  sparse: TokenAwareEmbedder,
) => ({
  maxTokens: resolveChunkTokenLimit(configuredChunkTokens, [dense.limits, sparse.limits]),
  countTokens: createCombinedTokenCounter(dense.countTokens, sparse.countTokens),
})
