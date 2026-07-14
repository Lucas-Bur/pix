import type { EmbeddingDtype } from "../domain/dtype.js"

/** Build the content-addressed identity for one embedding contract. */
export const embeddingCacheKey = (
  contentHash: string,
  model: string,
  dims: number,
  dtype: EmbeddingDtype,
): string => `${model}\u0000${dims}\u0000${dtype}\u0000${contentHash}`
