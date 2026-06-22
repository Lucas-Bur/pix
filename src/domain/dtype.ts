import { Data, Schema } from "effect"

/** Single source of truth for embedding dtype literals. */
export const EmbeddingDtypeSchema = Schema.Literal("fp32", "fp16", "q8", "q4")

/** Domain type inferred from EmbeddingDtypeSchema. */
export type EmbeddingDtype = typeof EmbeddingDtypeSchema.Type

/** Runtime schema for index metadata persisted to .pix/index-meta.json. */
export const IndexMetaSchema = Schema.Struct({
  dtype: EmbeddingDtypeSchema,
  dims: Schema.Number,
  model: Schema.String,
  lastIndex: Schema.Number,
})

/** Domain type inferred from IndexMetaSchema. */
export type IndexMeta = typeof IndexMetaSchema.Type

/**
 * The index was built with one dtype but the current config expects another. The caller must
 * re-index to resolve.
 */
export class DtypeMismatchError extends Data.TaggedError("DtypeMismatchError")<{
  readonly message: string
  readonly storedDtype: EmbeddingDtype
  readonly configDtype: EmbeddingDtype
}> {}

/**
 * Failed to decode a binary vector buffer into a Float32Array. Usually indicates a corrupt or
 * truncated vectors.bin file.
 */
export class VectorDecodeError extends Data.TaggedError("VectorDecodeError")<{
  readonly message: string
  readonly dtype: EmbeddingDtype
}> {}
