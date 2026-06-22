import { Context, Effect, Layer, Option } from "effect"

import type { EmbeddingDtype } from "../domain/dtype.js"

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
    description: "General-purpose sentence embeddings, 23MB q8",
  },
  "Xenova/bge-small-en-v1.5": {
    id: "Xenova/bge-small-en-v1.5",
    dims: 384,
    dtypes: ["fp32", "q8"],
    defaultDtype: "fp32",
    description: "BGE retrieval-optimized embeddings, 34MB q8",
  },
  "jinaai/jina-embeddings-v2-base-code": {
    id: "jinaai/jina-embeddings-v2-base-code",
    dims: 768,
    dtypes: ["fp32", "q8"],
    defaultDtype: "fp32",
    description: "Jina code-tuned embeddings, 8192 context, 162MB q8",
  },
}

/** Port for querying embedding model metadata (dtypes, dims, defaults). */
export class ModelRegistry extends Context.Tag("ModelRegistry")<
  ModelRegistry,
  {
    /** Look up model info by HuggingFace model identifier. Returns Option.none if unknown. */
    readonly get: (id: string) => Effect.Effect<Option.Option<ModelInfo>>
    /** List all registered model IDs. */
    readonly list: () => Effect.Effect<readonly string[]>
  }
>() {}

/** Live adapter: wraps the static MODEL_REGISTRY. */
export const ModelRegistryLive = Layer.succeed(ModelRegistry, {
  get: (id) => Effect.succeed(Option.fromNullable(MODEL_REGISTRY[id])),
  list: () => Effect.succeed(Object.keys(MODEL_REGISTRY)),
})
