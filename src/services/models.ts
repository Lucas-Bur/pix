import type { EmbeddingDtype } from "../domain/dtype.js"
import { EMBEDDING_DTYPES } from "../domain/dtype.js"

/** Metadata for a supported embedding model. */
export interface ModelInfo {
  /** HuggingFace model identifier. */
  readonly id: string
  /** Embedding vector dimensions produced by this model. */
  readonly dims: number
  /** Data types this model supports. */
  readonly dtypes: readonly EmbeddingDtype[]
  /** Human-readable description. */
  readonly description: string
}

/** Registry of supported embedding models. */
export const MODEL_REGISTRY: Record<string, ModelInfo> = {
  "Xenova/all-MiniLM-L6-v2": {
    id: "Xenova/all-MiniLM-L6-v2",
    dims: 384,
    dtypes: [...EMBEDDING_DTYPES],
    description: "General-purpose sentence embeddings, 23MB q8",
  },
  "Xenova/bge-small-en-v1.5": {
    id: "Xenova/bge-small-en-v1.5",
    dims: 384,
    dtypes: [...EMBEDDING_DTYPES],
    description: "BGE retrieval-optimized embeddings, 34MB q8",
  },
}
