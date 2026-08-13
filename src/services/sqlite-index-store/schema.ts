import { Effect, Schema, SchemaGetter, SchemaIssue } from "effect"
import { Model } from "effect/unstable/schema"

import { IndexDiagnosticSchema } from "../../domain/diagnostics.js"
import { EmbeddingDtypeSchema } from "../../domain/dtype.js"

const invalidVector = (value: unknown, message: string): SchemaIssue.InvalidValue =>
  new SchemaIssue.InvalidValue({ message }, value, { reportInput: true })

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
  avgChunkLength: Schema.Finite,
  chunkLengths: Schema.Array(Schema.Finite),
  docFreqs: Schema.Record(Schema.String, Schema.Finite),
  chunkTfs: Schema.Record(
    Schema.String,
    Schema.Array(Schema.Tuple([Schema.Finite, Schema.Finite])),
  ),
})

const IdentifierIndexSchema = Schema.Struct({
  exact: Schema.Record(Schema.String, Schema.Array(Schema.Finite)),
  split: Schema.Record(Schema.String, Schema.Array(Schema.Finite)),
})

const SparseVectorSchema = Schema.Struct({
  terms: Schema.Array(
    Schema.Struct({
      tokenId: Schema.Int,
      weight: Schema.Finite,
    }),
  ),
})

/** Persisted singleton describing the active index snapshot. */
export class IndexMetaRow extends Model.Class<IndexMetaRow>("IndexMetaRow")({
  id: Schema.Finite,
  model: Schema.String,
  dims: Schema.Finite,
  dtype: EmbeddingDtypeSchema,
  lastIndex: Schema.Finite,
  chunkTokens: Schema.Finite,
  quantized: Schema.Literals([0, 1]),
  diagnostics: Schema.fromJsonString(Schema.Array(IndexDiagnosticSchema)),
}) {}

/** Persisted chunk metadata and its Float32 embedding. */
export class ChunkRow extends Model.Class<ChunkRow>("ChunkRow")({
  ordinal: Schema.Finite,
  id: Schema.String,
  idx: Schema.Finite,
  file: Schema.String,
  startLine: Schema.Finite,
  endLine: Schema.Finite,
  startOffset: Schema.Finite,
  endOffset: Schema.Finite,
  contentHash: Schema.String,
  embedding: Float32ArrayFromBlob,
}) {}

/** Chunk row projected without its embedding for query-time retrieval metadata. */
export class ChunkMetadataRow extends Model.Class<ChunkMetadataRow>("ChunkMetadataRow")({
  ordinal: Schema.Finite,
  id: Schema.String,
  idx: Schema.Finite,
  file: Schema.String,
  startLine: Schema.Finite,
  endLine: Schema.Finite,
  startOffset: Schema.Finite,
  endOffset: Schema.Finite,
  contentHash: Schema.String,
}) {}

/** Decoded result from an exact or quantized SQLite vector scan. */
export const DenseMatchRow = Schema.Struct({
  ordinal: Schema.Finite,
  distance: Schema.Finite,
})

/** Schema-transformed request vector passed to sqlite-vector. */
export const DenseSearchRequest = Schema.Struct({ embedding: Float32ArrayFromBlob })

/** Persisted singleton describing the active learned sparse contract. */
export class SparseIndexMetaRow extends Model.Class<SparseIndexMetaRow>("SparseIndexMetaRow")({
  id: Schema.Int,
  model: Schema.String,
  modelRevision: Schema.String,
  tokenizer: Schema.String,
  tokenizerRevision: Schema.String,
  idfRevision: Schema.String,
  idfContentHash: Schema.String,
}) {}

/** One persisted non-zero sparse dimension attached to a chunk ordinal. */
export class SparseTermRow extends Model.Class<SparseTermRow>("SparseTermRow")({
  chunkOrdinal: Schema.Int,
  tokenId: Schema.Int,
  weight: Schema.Finite,
}) {}

/** One static query-IDF weight persisted by tokenizer token ID. */
export class SparseIdfRow extends Model.Class<SparseIdfRow>("SparseIdfRow")({
  tokenId: Schema.Int,
  weight: Schema.Finite,
}) {}

/** Decoded result from exact sparse inner-product ranking. */
export const SparseMatchRow = Schema.Struct({
  ordinal: Schema.Int,
  score: Schema.Finite,
})

/** Persisted source-file observation used by incremental indexing. */
export class FileManifestRow extends Model.Class<FileManifestRow>("FileManifestRow")({
  file: Schema.String,
  mtimeMs: Schema.Finite,
  size: Schema.Finite,
  contentHash: Schema.String,
}) {}

/** Schema-transformed retrieval indexes stored as JSON text in SQLite. */
export class RetrievalIndexesRow extends Model.Class<RetrievalIndexesRow>("RetrievalIndexesRow")({
  id: Schema.Finite,
  bm25Index: Schema.fromJsonString(Bm25IndexSchema),
  identifierIndex: Schema.fromJsonString(IdentifierIndexSchema),
}) {}

/** Historical content-addressed embedding retained outside the active snapshot. */
export class EmbeddingCacheRow extends Model.Class<EmbeddingCacheRow>("EmbeddingCacheRow")({
  contentHash: Schema.String,
  model: Schema.String,
  dims: Schema.Finite,
  dtype: EmbeddingDtypeSchema,
  embedding: Float32ArrayFromBlob,
}) {}

/** Historical content-addressed Sparse vector retained outside the active snapshot. */
export class SparseEmbeddingCacheRow extends Model.Class<SparseEmbeddingCacheRow>(
  "SparseEmbeddingCacheRow",
)({
  contentHash: Schema.String,
  model: Schema.String,
  modelRevision: Schema.String,
  tokenizer: Schema.String,
  tokenizerRevision: Schema.String,
  idfRevision: Schema.String,
  idfContentHash: Schema.String,
  vector: Schema.fromJsonString(SparseVectorSchema),
}) {}
