import { Effect } from "effect"

import type { InferenceError, ModelLoadError } from "../domain/errors.js"
import { resolveChunkTokenLimit } from "../domain/models.js"
import type { EmbeddingLimits } from "../domain/ports.js"

type TokenCounter = (text: string) => Effect.Effect<number, ModelLoadError | InferenceError>

type TokenAwareEmbedder = {
  readonly limits: EmbeddingLimits
  readonly countTokens: TokenCounter
}

const DEFAULT_TOKEN_COUNT_CACHE_SIZE = 4_096

/** Create a cached counter that uses the larger count from the active Dense and Sparse tokenizers. */
export const createCombinedTokenCounter = (
  dense: TokenCounter,
  sparse: TokenCounter,
  maxEntries = DEFAULT_TOKEN_COUNT_CACHE_SIZE,
): TokenCounter => {
  const counts = new Map<string, number>()
  const cacheSize = Math.max(1, Math.floor(maxEntries))

  return (text: string) => {
    const cached = counts.get(text)
    if (cached !== undefined) {
      counts.delete(text)
      counts.set(text, cached)
      return Effect.succeed(cached)
    }
    return Effect.all([dense(text), sparse(text)]).pipe(
      Effect.map(([denseCount, sparseCount]) => {
        const count = Math.max(denseCount, sparseCount)
        if (counts.size >= cacheSize) {
          const oldest = counts.keys().next().value
          if (oldest !== undefined) counts.delete(oldest)
        }
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
