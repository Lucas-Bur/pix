import { Effect } from "effect"

import type { EmbeddingDtype } from "../../domain/dtype.js"
import { ModelLoadError } from "../../domain/errors.js"
import type { ConfigStore } from "../../domain/ports.js"
import { MODEL_REGISTRY } from "../../services/models.js"

/** Resolved embedder model + dtype + dims, as a value object (not an Effect). */
export interface ResolvedEmbedderConfig {
  readonly model: string
  readonly dtype: EmbeddingDtype
  readonly dims: number
}

/**
 * Read `.pix/config.json` and resolve the embedder model metadata from the registry.
 *
 * Shared by `Embedder` (which then layers device detection on top) and `BenchProject` (which only
 * needs the model metadata to enumerate devices). Falls back to the default model when the config
 * is unreadable (so benchmarks can run on a project without an explicit embedder.model setting) —
 * callers that require an explicit model should layer a check on top.
 *
 * Fails with `ModelLoadError` if `config.embedder.model` is set to a registry-unknown ID.
 */
export const resolveEmbedderConfig = (
  configStore: typeof ConfigStore.Service,
): Effect.Effect<ResolvedEmbedderConfig, ModelLoadError> =>
  Effect.gen(function* () {
    const config = yield* configStore
      .readConfig()
      .pipe(Effect.catch(() => Effect.succeed(undefined)))
    const model = config?.embedder.model ?? "Xenova/all-MiniLM-L6-v2"
    const dtype: EmbeddingDtype = config?.embedder.dtype ?? "fp32"
    const modelInfo = MODEL_REGISTRY[model]
    if (!modelInfo) {
      return yield* new ModelLoadError({
        message: `Unknown embedding model "${model}"`,
        model,
      })
    }
    return { model, dtype, dims: modelInfo.dims }
  })
