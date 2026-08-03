import type { EmbeddingDtype } from "../domain/dtype.js"
import type { SparseContract } from "../domain/sparse.js"

/** Build the content-addressed identity for one embedding contract. */
export const embeddingCacheKey = (
  contentHash: string,
  model: string,
  dims: number,
  dtype: EmbeddingDtype,
): string => `${model}\u0000${dims}\u0000${dtype}\u0000${contentHash}`

/** Build the content-addressed identity for one sparse embedding contract. */
export const sparseEmbeddingCacheKey = (contentHash: string, contract: SparseContract): string =>
  `${contract.model}\u0000${contract.modelRevision}\u0000${contract.tokenizer}\u0000${contract.tokenizerRevision}\u0000${contract.idfRevision}\u0000${contract.idfContentHash}\u0000${contentHash}`
