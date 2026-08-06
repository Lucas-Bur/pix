import { createHash } from "node:crypto"

import { NodePath } from "@effect/platform-node"
import { AutoConfig, AutoModelForMaskedLM, AutoTokenizer, env } from "@huggingface/transformers"
import { Effect, Layer, Path } from "effect"

import type { DeviceType } from "../domain/device.js"
import { InferenceError, ModelLoadError, TokenLimitError } from "../domain/errors.js"
import { SPARSE_MODEL_REGISTRY } from "../domain/models.js"
import {
  ConfigStore,
  SparseEmbedder,
  type BoundSparseEmbedder,
  type SparseDeviceConfig,
} from "../domain/ports.js"
import type { EmbeddingLimits } from "../domain/ports.js"
import {
  type SparseContract,
  type SparseQuery,
  type SparseTerm,
  type SparseVector,
} from "../domain/sparse.js"
import { resolveTransformersCacheDir } from "../lib/model-cache.js"
import { buildSparseQueryTokenIds, poolSparseLogits } from "../lib/sparse/encoding.js"
import { ConfigStoreLive } from "./config-store.js"
import { loadFirstAvailableDevice } from "./device-detect.js"

const DOCUMENT_MODULE = "document_0_MLMTransformer"
const DOCUMENT_ONNX_MODULE = `${DOCUMENT_MODULE}/onnx`
const IDF_DOWNLOAD_TIMEOUT_MS = 60_000

/** Loaded tokenizer type inferred from Transformers.js. */
type SparseTokenizer = Awaited<ReturnType<typeof AutoTokenizer.from_pretrained>>

/** Loaded masked-language-model type inferred from Transformers.js. */
type SparseDocumentModel = Awaited<ReturnType<typeof AutoModelForMaskedLM.from_pretrained>>

/** Tokenizer resources shared by document and query encoding. */
interface QueryRuntime {
  readonly tokenizer: SparseTokenizer
  readonly specialTokenIds: ReadonlySet<number>
}

const asModelLoadError = (model: string, message: string) => (cause: unknown) =>
  new ModelLoadError({ message, model, cause })

const encodeModelPath = (model: string): string =>
  model
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/")

const loadTokenizer = (
  model: string,
  revision: string,
): Effect.Effect<SparseTokenizer, ModelLoadError> =>
  Effect.tryPromise(() => AutoTokenizer.from_pretrained(model, { revision })).pipe(
    Effect.mapError(asModelLoadError(model, `Failed to load sparse tokenizer "${model}"`)),
  )

const loadIdf = (
  model: string,
  revision: string,
  expectedHash: string,
  tokenizer: SparseTokenizer,
): Effect.Effect<readonly SparseTerm[], ModelLoadError> =>
  Effect.tryPromise(async () => {
    const response = await fetch(
      `https://huggingface.co/${encodeModelPath(model)}/resolve/${encodeURIComponent(revision)}/idf.json`,
      { signal: AbortSignal.timeout(IDF_DOWNLOAD_TIMEOUT_MS) },
    )
    if (!response.ok) throw new Error(`Sparse IDF download failed with HTTP ${response.status}`)
    const file = new Uint8Array(await response.arrayBuffer())
    const actualHash = createHash("sha256").update(file).digest("hex")
    if (actualHash !== expectedHash) {
      throw new Error(`Sparse IDF hash mismatch: expected ${expectedHash}, got ${actualHash}`)
    }
    const parsed: unknown = JSON.parse(new TextDecoder().decode(file))
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new Error("Sparse IDF payload must be an object")
    }
    const specialTokenIds = new Set(tokenizer.all_special_ids)
    const weights: SparseTerm[] = []
    for (const [token, tokenId] of tokenizer.get_vocab()) {
      const weight = Reflect.get(parsed, token)
      if (
        typeof weight === "number" &&
        Number.isFinite(weight) &&
        weight > 0 &&
        !specialTokenIds.has(tokenId)
      ) {
        weights.push({ tokenId, weight })
      }
    }
    return weights.sort((left, right) => left.tokenId - right.tokenId)
  }).pipe(Effect.mapError(asModelLoadError(model, `Failed to load sparse IDF from "${model}"`)))

const loadDocumentModel = (
  model: string,
  revision: string,
  configModel: string,
  configRevision: string,
  device: DeviceType,
): Effect.Effect<SparseDocumentModel, ModelLoadError> =>
  Effect.tryPromise(async () => {
    // The repository root is a Sentence-Transformers router. Transformers.js needs the standard
    // DistilBERT module config while it still owns download, cache, ONNX selection, and execution.
    const config = await AutoConfig.from_pretrained(configModel, { revision: configRevision })
    return await AutoModelForMaskedLM.from_pretrained(model, {
      revision,
      subfolder: DOCUMENT_ONNX_MODULE,
      config,
      device,
      dtype: "fp32",
    })
  }).pipe(
    Effect.mapError(asModelLoadError(model, `Failed to load sparse document model "${model}"`)),
  )

const make = Effect.gen(function* () {
  const path = yield* Path.Path
  env.cacheDir = yield* resolveTransformersCacheDir({ projectRoot: path.resolve() })
  const config = yield* (yield* ConfigStore).readConfig()
  const sparse = config.sparseEmbedder
  const modelInfo = SPARSE_MODEL_REGISTRY[sparse.model]
  if (modelInfo === undefined) {
    return yield* new ModelLoadError({
      message: `Unknown sparse document model "${sparse.model}"`,
      model: sparse.model,
    })
  }
  if (modelInfo.maxInputTokens > modelInfo.hardTokenLimit) {
    return yield* new ModelLoadError({
      message: `Invalid token limits for "${sparse.model}": maxInputTokens (${modelInfo.maxInputTokens}) exceeds hardTokenLimit (${modelInfo.hardTokenLimit})`,
      model: sparse.model,
    })
  }
  const limits: EmbeddingLimits = {
    model: modelInfo.id,
    hardTokenLimit: modelInfo.hardTokenLimit,
    maxInputTokens: modelInfo.maxInputTokens,
  }
  const contract: SparseContract = {
    model: sparse.model,
    modelRevision: sparse.modelRevision,
    tokenizer: sparse.queryModel,
    tokenizerRevision: sparse.queryRevision,
    idfRevision: sparse.queryRevision,
    idfContentHash: sparse.idfContentHash,
  }

  const getTokenizer = yield* Effect.cached(loadTokenizer(sparse.queryModel, sparse.queryRevision))
  const getQueryRuntime = yield* Effect.cached(
    Effect.gen(function* () {
      const tokenizer = yield* getTokenizer
      return {
        tokenizer,
        specialTokenIds: new Set(tokenizer.all_special_ids),
      } satisfies QueryRuntime
    }),
  )
  const loadConfiguredDocumentModel = (device: DeviceType) =>
    loadDocumentModel(
      sparse.model,
      sparse.modelRevision,
      sparse.queryModel,
      sparse.queryRevision,
      device,
    )
  const getDocumentModel = yield* Effect.cached(
    sparse.device === "auto"
      ? loadFirstAvailableDevice(sparse.model, loadConfiguredDocumentModel).pipe(
          Effect.map(({ value }) => value),
        )
      : loadConfiguredDocumentModel(sparse.device),
  )

  const makeBound = (
    documentModel: Effect.Effect<SparseDocumentModel, ModelLoadError>,
    batchSize: number,
  ): BoundSparseEmbedder => {
    const batch = (
      texts: readonly string[],
    ): Effect.Effect<readonly SparseVector[], ModelLoadError | InferenceError | TokenLimitError> =>
      Effect.gen(function* () {
        if (texts.length === 0) return []
        if (texts.length > batchSize) {
          return yield* new TokenLimitError({
            message: `Sparse batch for "${sparse.model}" has ${texts.length} inputs; the batch limit is ${batchSize}`,
            model: sparse.model,
            actualTokens: texts.length,
            limit: batchSize,
            scope: "batch",
          })
        }
        const [{ tokenizer, specialTokenIds }, model] = yield* Effect.all([
          getQueryRuntime,
          documentModel,
        ])
        const counts = yield* Effect.forEach(texts, (text) =>
          Effect.try({
            try: () =>
              tokenizer(text, {
                add_special_tokens: true,
                truncation: false,
                return_tensor: false,
              }).input_ids.length,
            catch: (cause) => new InferenceError({ message: "Sparse tokenization failed", cause }),
          }),
        )
        const tooLong = counts.find((count) => count > limits.maxInputTokens)
        if (tooLong !== undefined) {
          return yield* new TokenLimitError({
            message: `Sparse input for "${sparse.model}" has ${tooLong} tokens; the maximum is ${limits.maxInputTokens}`,
            model: sparse.model,
            actualTokens: tooLong,
            limit: limits.maxInputTokens,
            scope: "input",
          })
        }
        return yield* Effect.tryPromise(async () => {
          const inputs = tokenizer([...texts], { padding: true, truncation: false })
          const output = await model.forward(inputs)
          const logits = output.logits
          const [logitsBatchSize, sequenceLength, vocabularySize] = logits.dims
          if (
            logitsBatchSize === undefined ||
            sequenceLength === undefined ||
            vocabularySize === undefined
          ) {
            throw new Error(`Unexpected sparse logits shape: ${logits.dims.join("x")}`)
          }
          if (logits.type !== "float32") {
            throw new Error(`Unexpected sparse logits dtype: ${logits.type}`)
          }
          return poolSparseLogits(
            logits.data as Float32Array,
            [logitsBatchSize, sequenceLength, vocabularySize],
            Array.from(inputs.attention_mask.data, Number),
            specialTokenIds,
          )
        }).pipe(
          Effect.mapError(
            (cause) => new InferenceError({ message: "Sparse document inference failed", cause }),
          ),
        )
      })

    const countTokens = (text: string): Effect.Effect<number, ModelLoadError | InferenceError> =>
      Effect.gen(function* () {
        const { tokenizer } = yield* getQueryRuntime
        return yield* Effect.try({
          try: () =>
            tokenizer(text, {
              add_special_tokens: true,
              truncation: false,
              return_tensor: false,
            }).input_ids.length,
          catch: (cause) => new InferenceError({ message: "Sparse tokenization failed", cause }),
        })
      })

    return { limits, countTokens, batch }
  }

  const bound = makeBound(getDocumentModel, sparse.batchSize)
  const createForDevice = (
    cfg: SparseDeviceConfig,
  ): Effect.Effect<BoundSparseEmbedder, ModelLoadError> =>
    loadDocumentModel(
      sparse.model,
      sparse.modelRevision,
      sparse.queryModel,
      sparse.queryRevision,
      cfg.device,
    ).pipe(Effect.map((model) => makeBound(Effect.succeed(model), cfg.batchSize)))

  const loadStaticIdf = (): Effect.Effect<readonly SparseTerm[], ModelLoadError> =>
    Effect.gen(function* () {
      const { tokenizer } = yield* getQueryRuntime
      return yield* loadIdf(
        sparse.queryModel,
        sparse.queryRevision,
        sparse.idfContentHash,
        tokenizer,
      )
    })

  const tokenizeQuery = (
    text: string,
  ): Effect.Effect<SparseQuery, ModelLoadError | InferenceError> =>
    Effect.gen(function* () {
      const runtime = yield* getQueryRuntime
      return yield* Effect.try({
        try: () => {
          const inputs = runtime.tokenizer(text, { truncation: true })
          const tokenIds = buildSparseQueryTokenIds(
            Array.from(inputs.input_ids.data, Number),
            runtime.specialTokenIds,
          )
          return { tokenIds, contract }
        },
        catch: (cause) =>
          new InferenceError({ message: "Sparse query tokenization failed", cause }),
      })
    })

  return {
    contract,
    limits,
    countTokens: bound.countTokens,
    batch: bound.batch,
    createForDevice,
    loadIdf: loadStaticIdf,
    tokenizeQuery,
  } as const
})

/** Sparse embedder adapter without its ConfigStore dependency. */
export const SparseEmbedderBase = Layer.provideMerge(
  Layer.effect(SparseEmbedder, make),
  NodePath.layer,
)

/** Transformers.js adapter for learned sparse document and static-IDF query encoding. */
export const SparseEmbedderLive = Layer.provideMerge(SparseEmbedderBase, ConfigStoreLive)
