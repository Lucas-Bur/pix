import type { EmbeddingDtype } from "./dtype.js"
import { SPARSE_DOCUMENT_MODEL } from "./sparse.js"

/** Hard and conservative operational input limits for one model. */
export interface ModelTokenLimits {
  readonly hardTokenLimit: number
  readonly operationalTokenLimit: number
}

/** Metadata for a supported embedding model. */
export interface ModelInfo extends ModelTokenLimits {
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

/** Metadata for a supported learned Sparse document model. */
export interface SparseModelInfo extends ModelTokenLimits {
  readonly id: string
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

/** Registry of pinned Sparse document model metadata. */
export const SPARSE_MODEL_REGISTRY: Record<string, SparseModelInfo> = {
  [SPARSE_DOCUMENT_MODEL]: {
    id: SPARSE_DOCUMENT_MODEL,
    hardTokenLimit: 512,
    operationalTokenLimit: 512,
  },
}
