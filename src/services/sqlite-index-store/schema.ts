import { Effect, Option, Schema, SchemaGetter, SchemaIssue } from "effect"
import { Model } from "effect/unstable/schema"

import { EmbeddingDtypeSchema } from "../../domain/dtype.js"

const invalidVector = (value: unknown, message: string): SchemaIssue.InvalidValue =>
  new SchemaIssue.InvalidValue(Option.some(value), { message })

/** SQLite BLOB codec for the Float32 vectors used by pix. */
export const Float32ArrayFromBlob = Schema.Uint8Array.pipe(
  Schema.decodeTo(Schema.instanceOf(Float32Array), {
    decode: SchemaGetter.transformOrFail((bytes) => {
      if (bytes.byteLength % Float32Array.BYTES_PER_ELEMENT !== 0) {
        return Effect.fail(
          invalidVector(bytes, "Vector BLOB byte length must be divisible by four"),
        )
      }
      const copy = new Uint8Array(bytes.byteLength)
      copy.set(bytes)
      return Effect.succeed(new Float32Array(copy.buffer))
    }),
    encode: SchemaGetter.transform((vector) => {
      const bytes = new Uint8Array(vector.buffer, vector.byteOffset, vector.byteLength)
      const copy = new Uint8Array(bytes.byteLength)
      copy.set(bytes)
      return copy
    }),
  }),
)

const Bm25IndexSchema = Schema.Struct({
  avgChunkLength: Schema.Number,
  chunkLengths: Schema.Array(Schema.Number),
  docFreqs: Schema.Record(Schema.String, Schema.Number),
  chunkTfs: Schema.Record(
    Schema.String,
    Schema.Array(Schema.Tuple([Schema.Number, Schema.Number])),
  ),
})

const IdentifierIndexSchema = Schema.Struct({
  exact: Schema.Record(Schema.String, Schema.Array(Schema.Number)),
  split: Schema.Record(Schema.String, Schema.Array(Schema.Number)),
})

/** Persisted singleton describing the active index snapshot. */
export class IndexMetaRow extends Model.Class<IndexMetaRow>("IndexMetaRow")({
  id: Schema.Number,
  model: Schema.String,
  dims: Schema.Number,
  dtype: EmbeddingDtypeSchema,
  lastIndex: Schema.Number,
  quantized: Schema.Literals([0, 1]),
}) {}

/** Persisted chunk metadata and its Float32 embedding. */
export class ChunkRow extends Model.Class<ChunkRow>("ChunkRow")({
  ordinal: Schema.Number,
  id: Schema.String,
  idx: Schema.Number,
  file: Schema.String,
  startLine: Schema.Number,
  endLine: Schema.Number,
  startOffset: Schema.Number,
  endOffset: Schema.Number,
  contentHash: Schema.String,
  embedding: Float32ArrayFromBlob,
}) {}

/** Chunk row projected without its embedding for query-time retrieval metadata. */
export class ChunkMetadataRow extends Model.Class<ChunkMetadataRow>("ChunkMetadataRow")({
  ordinal: Schema.Number,
  id: Schema.String,
  idx: Schema.Number,
  file: Schema.String,
  startLine: Schema.Number,
  endLine: Schema.Number,
  startOffset: Schema.Number,
  endOffset: Schema.Number,
  contentHash: Schema.String,
}) {}

/** Decoded result from an exact or quantized SQLite vector scan. */
export const DenseMatchRow = Schema.Struct({
  ordinal: Schema.Number,
  distance: Schema.Number,
})

/** Schema-transformed request vector passed to sqlite-vector. */
export const DenseSearchRequest = Schema.Struct({ embedding: Float32ArrayFromBlob })

/** Persisted singleton describing the active learned sparse contract. */
export class SparseIndexMetaRow extends Model.Class<SparseIndexMetaRow>("SparseIndexMetaRow")({
  id: Schema.Number,
  model: Schema.String,
  modelRevision: Schema.String,
  tokenizer: Schema.String,
  tokenizerRevision: Schema.String,
  idfRevision: Schema.String,
  idfContentHash: Schema.String,
}) {}

/** One persisted non-zero sparse dimension attached to a chunk ordinal. */
export class SparseTermRow extends Model.Class<SparseTermRow>("SparseTermRow")({
  chunkOrdinal: Schema.Number,
  tokenId: Schema.Number,
  weight: Schema.Number,
}) {}

/** One static query-IDF weight persisted by tokenizer token ID. */
export class SparseIdfRow extends Model.Class<SparseIdfRow>("SparseIdfRow")({
  tokenId: Schema.Number,
  weight: Schema.Number,
}) {}

/** Decoded result from exact sparse inner-product ranking. */
export const SparseMatchRow = Schema.Struct({
  ordinal: Schema.Number,
  score: Schema.Number,
})

/** Persisted source-file observation used by incremental indexing. */
export class FileManifestRow extends Model.Class<FileManifestRow>("FileManifestRow")({
  file: Schema.String,
  mtimeMs: Schema.Number,
  size: Schema.Number,
  contentHash: Schema.String,
}) {}

/** Schema-transformed retrieval indexes stored as JSON text in SQLite. */
export class RetrievalIndexesRow extends Model.Class<RetrievalIndexesRow>("RetrievalIndexesRow")({
  id: Schema.Number,
  bm25Index: Schema.fromJsonString(Bm25IndexSchema),
  identifierIndex: Schema.fromJsonString(IdentifierIndexSchema),
}) {}

/** Historical content-addressed embedding retained outside the active snapshot. */
export class EmbeddingCacheRow extends Model.Class<EmbeddingCacheRow>("EmbeddingCacheRow")({
  contentHash: Schema.String,
  model: Schema.String,
  dims: Schema.Number,
  dtype: EmbeddingDtypeSchema,
  embedding: Float32ArrayFromBlob,
}) {}
