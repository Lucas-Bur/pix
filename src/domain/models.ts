import type { EmbeddingDtype } from "./dtype.js"

/** Metadata for a supported embedding model. */
export interface ModelInfo {
  /** HuggingFace model identifier. */
  readonly id: string
  /** Embedding vector dimensions produced by this model. */
  readonly dims: number
  /** Data types this model supports. Manually verified per model. */
  readonly dtypes: readonly EmbeddingDtype[]
  /** Default dtype to use when healing an unsupported dtype for this model. */
  readonly defaultDtype: EmbeddingDtype
  /** Hard maximum input length accepted by the model, including special tokens. */
  readonly hardTokenLimit: number
  /** Conservative per-input limit used by production embedding. Never exceeds hardTokenLimit. */
  readonly operationalTokenLimit: number
  /** Human-readable description. */
  readonly description: string
}

/** Registry of supported embedding models. Dtypes are manually verified per model. */
export const MODEL_REGISTRY: Record<string, ModelInfo> = {
  "Xenova/all-MiniLM-L6-v2": {
    id: "Xenova/all-MiniLM-L6-v2",
    dims: 384,
    dtypes: ["fp32", "q8"],
    defaultDtype: "fp32",
    hardTokenLimit: 512,
    operationalTokenLimit: 512,
    description: "General-purpose sentence embeddings, 23MB q8",
  },
  "Xenova/bge-small-en-v1.5": {
    id: "Xenova/bge-small-en-v1.5",
    dims: 384,
    dtypes: ["fp32", "q8"],
    defaultDtype: "fp32",
    hardTokenLimit: 512,
    operationalTokenLimit: 512,
    description: "BGE retrieval-optimized embeddings, 34MB q8",
  },
  "jinaai/jina-embeddings-v2-base-code": {
    id: "jinaai/jina-embeddings-v2-base-code",
    dims: 768,
    dtypes: ["fp32", "q8"],
    defaultDtype: "fp32",
    hardTokenLimit: 8192,
    operationalTokenLimit: 2048,
    description: "Jina code-tuned embeddings, 8192 context, 162MB q8",
  },
}
