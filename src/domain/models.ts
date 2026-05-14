/** Metadata for a supported embedding model. */
export interface ModelInfo {
  /** HuggingFace model identifier. */
  readonly id: string
  /** Embedding vector dimensions produced by this model. */
  readonly dims: number
  /** Data types this model supports. */
  readonly dtypes: readonly ("fp32" | "fp16" | "q8" | "q4")[]
  /** Human-readable description. */
  readonly description: string
}

/** Registry of supported embedding models. */
export const MODEL_REGISTRY: Record<string, ModelInfo> = {
  "Xenova/all-MiniLM-L6-v2": {
    id: "Xenova/all-MiniLM-L6-v2",
    dims: 384,
    dtypes: ["fp32", "fp16", "q8", "q4"],
    description: "General-purpose sentence embeddings, 23MB q8",
  },
  "Xenova/bge-small-en-v1.5": {
    id: "Xenova/bge-small-en-v1.5",
    dims: 384,
    dtypes: ["fp32", "fp16", "q8", "q4"],
    description: "BGE retrieval-optimized embeddings, 34MB q8",
  },
}
