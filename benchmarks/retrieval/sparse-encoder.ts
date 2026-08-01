import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"

import { Effect, Schema } from "effect"

/** Hugging Face ONNX export used for benchmark document encoding. */
export const SPARSE_DOCUMENT_MODEL =
  "raul3820/opensearch-neural-sparse-encoding-doc-v3-distill-onnx"

/** Matching tokenizer and static query-weight source. */
export const SPARSE_TOKENIZER_MODEL =
  "opensearch-project/opensearch-neural-sparse-encoding-doc-v3-distill"

/** Batch size used by the sparse ONNX benchmark adapter. */
export const SPARSE_BATCH_SIZE = 2

const DOCUMENT_SUBFOLDER = "document_0_MLMTransformer"
const DOCUMENT_ONNX_SUBFOLDER = `${DOCUMENT_SUBFOLDER}/onnx`
const DOCUMENT_CONFIG_URL = `https://huggingface.co/${SPARSE_DOCUMENT_MODEL}/resolve/main/${DOCUMENT_SUBFOLDER}/config.json`
const QUERY_IDF_URL = `https://huggingface.co/${SPARSE_TOKENIZER_MODEL}/resolve/main/idf.json`
const IDF_CACHE_PATH = path.resolve("benchmarks/.cache/sparse", "query-idf.json")

const IdfSchema = Schema.Record(Schema.String, Schema.Number)

/** One non-zero token weight in a sparse vector. */
export interface SparseEntry {
  readonly tokenId: number
  readonly weight: number
}

/** Sparse token-weight vector produced for one document or query. */
export type SparseVector = readonly SparseEntry[]

/** Loaded sparse encoder used by the benchmark runner. */
export interface SparseEncoder {
  readonly model: string
  readonly tokenizerModel: string
  readonly device: "cpu"
  readonly batchSize: number
  readonly modelLoadDurationMs: number
  readonly encodeDocuments: (texts: readonly string[]) => Promise<readonly SparseVector[]>
  readonly encodeQueries: (texts: readonly string[]) => Promise<readonly SparseVector[]>
  readonly dispose: () => Promise<void>
}

const readCachedIdf = async (): Promise<Readonly<Record<string, number>> | undefined> => {
  const text = await readFile(IDF_CACHE_PATH, "utf8").catch(() => undefined)
  if (text === undefined) return undefined
  try {
    return Schema.decodeUnknownSync(IdfSchema)(JSON.parse(text))
  } catch {
    return undefined
  }
}

const loadIdf = async (): Promise<Readonly<Record<string, number>>> => {
  const cached = await readCachedIdf()
  if (cached !== undefined) return cached

  const response = await fetch(QUERY_IDF_URL)
  if (!response.ok) throw new Error(`Failed to fetch sparse query IDF table: ${response.status}`)
  const idf = Schema.decodeUnknownSync(IdfSchema)(await response.json())
  await mkdir(path.dirname(IDF_CACHE_PATH), { recursive: true })
  await writeFile(IDF_CACHE_PATH, `${JSON.stringify(idf)}\n`, "utf8")
  return idf
}

const sortedEntries = (weights: ReadonlyMap<number, number>): SparseVector =>
  [...weights]
    .filter(([, weight]) => weight > 0)
    .map(([tokenId, weight]) => ({ tokenId, weight }))
    .sort((left, right) => right.weight - left.weight || left.tokenId - right.tokenId)

/** Convert one logits row into OpenSearch-style positive sparse token weights. */
export const sparseEntriesFromLogits = (
  data: ArrayLike<number | bigint>,
  sequenceLength: number,
  vocabularySize: number,
  attentionMask: readonly number[],
  specialTokenIds: ReadonlySet<number>,
  dataOffset = 0,
): SparseVector => {
  const maximums = new Float64Array(vocabularySize)
  maximums.fill(Number.NEGATIVE_INFINITY)
  for (let position = 0; position < sequenceLength; position++) {
    if ((attentionMask[position] ?? 0) === 0) continue
    const rowOffset = dataOffset + position * vocabularySize
    for (let tokenId = 0; tokenId < vocabularySize; tokenId++) {
      const value = Number(data[rowOffset + tokenId] ?? Number.NEGATIVE_INFINITY)
      if (value > maximums[tokenId]!) maximums[tokenId] = value
    }
  }

  const weights = new Map<number, number>()
  for (let tokenId = 0; tokenId < vocabularySize; tokenId++) {
    if (specialTokenIds.has(tokenId)) continue
    const maximum = maximums[tokenId]!
    const weight = Math.log1p(Math.log1p(Math.max(0, maximum)))
    if (weight > 0) weights.set(tokenId, weight)
  }
  return sortedEntries(weights)
}

const encodeDocumentBatch = async (
  tokenizer: Awaited<
    ReturnType<typeof import("@huggingface/transformers").AutoTokenizer.from_pretrained>
  >,
  model: Awaited<
    ReturnType<typeof import("@huggingface/transformers").AutoModelForMaskedLM.from_pretrained>
  >,
  specialTokenIds: ReadonlySet<number>,
  texts: readonly string[],
): Promise<readonly SparseVector[]> => {
  if (texts.length === 0) return []
  const inputs = tokenizer([...texts], { padding: true, truncation: true })
  const inputIds = inputs.input_ids
  const attentionMask = inputs.attention_mask
  const [batch, sequenceLength] = inputIds.dims
  const output = await model.forward(inputs)
  const logits = output.logits
  const [logitBatch, logitSequenceLength, vocabularySize] = logits.dims
  if (
    batch !== texts.length ||
    logitBatch !== texts.length ||
    logitSequenceLength !== sequenceLength ||
    attentionMask.dims[0] !== texts.length ||
    attentionMask.dims[1] !== sequenceLength
  ) {
    throw new Error(`Unexpected sparse model shape: ${logits.dims.join("x")}`)
  }

  const mask = Array.from(attentionMask.data, (value) => Number(value))
  const rowSize = sequenceLength * vocabularySize
  return Array.from({ length: texts.length }, (_, row) =>
    sparseEntriesFromLogits(
      logits.data,
      sequenceLength,
      vocabularySize,
      mask.slice(row * sequenceLength, (row + 1) * sequenceLength),
      specialTokenIds,
      row * rowSize,
    ),
  )
}

const encodeQuery = (
  tokenizer: Awaited<
    ReturnType<typeof import("@huggingface/transformers").AutoTokenizer.from_pretrained>
  >,
  idfByToken: ReadonlyMap<number, number>,
  specialTokenIds: ReadonlySet<number>,
  text: string,
): SparseVector => {
  const weights = new Map<number, number>()
  for (const tokenId of tokenizer.encode(text)) {
    if (specialTokenIds.has(tokenId)) continue
    const weight = idfByToken.get(tokenId)
    if (weight !== undefined) weights.set(tokenId, weight)
  }
  return sortedEntries(weights)
}

/** Load the Distill ONNX document model and its inference-free static query lookup. */
export const createSparseEncoder = (): Effect.Effect<SparseEncoder, Error> =>
  Effect.tryPromise({
    try: async () => {
      const startedAt = performance.now()
      const { AutoModelForMaskedLM, AutoTokenizer, PretrainedConfig, env } =
        await import("@huggingface/transformers")
      env.cacheDir = ".pix/cache"
      const tokenizer = await AutoTokenizer.from_pretrained(SPARSE_TOKENIZER_MODEL)
      const configResponse = await fetch(DOCUMENT_CONFIG_URL)
      if (!configResponse.ok)
        throw new Error(`Failed to fetch sparse document config: ${configResponse.status}`)
      const documentConfig = new PretrainedConfig(await configResponse.json())
      const model = await AutoModelForMaskedLM.from_pretrained(SPARSE_DOCUMENT_MODEL, {
        subfolder: DOCUMENT_ONNX_SUBFOLDER,
        config: documentConfig,
        device: "cpu",
      })
      const idf = await loadIdf()
      const idfByToken = new Map<number, number>()
      for (const [token, tokenId] of tokenizer.get_vocab()) {
        const weight = idf[token]
        if (weight !== undefined) idfByToken.set(tokenId, weight)
      }
      const specialTokenIds = new Set(tokenizer.all_special_ids)

      return {
        model: SPARSE_DOCUMENT_MODEL,
        tokenizerModel: SPARSE_TOKENIZER_MODEL,
        device: "cpu",
        batchSize: SPARSE_BATCH_SIZE,
        modelLoadDurationMs: performance.now() - startedAt,
        encodeDocuments: (texts) => encodeDocumentBatch(tokenizer, model, specialTokenIds, texts),
        encodeQueries: async (texts) =>
          texts.map((text) => encodeQuery(tokenizer, idfByToken, specialTokenIds, text)),
        dispose: async () => {
          await model.dispose()
        },
      } satisfies SparseEncoder
    },
    catch: (cause) => new Error("Could not load sparse benchmark encoder", { cause }),
  })
