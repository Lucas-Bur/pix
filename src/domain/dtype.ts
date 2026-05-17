import { Data, Schema } from "effect"

/** Single source of truth for embedding dtype literals. */
export const EmbeddingDtypeSchema = Schema.Literal("fp32", "fp16", "q8", "q4")

/** Domain type inferred from EmbeddingDtypeSchema. */
export type EmbeddingDtype = typeof EmbeddingDtypeSchema.Type

/** Readonly array of all valid dtype values, derived from schema. */
export const EMBEDDING_DTYPES = [
  "fp32",
  "fp16",
  "q8",
  "q4",
] as const satisfies readonly EmbeddingDtype[]

/** Runtime schema for index metadata persisted to .pix/index-meta.json. */
export const IndexMetaSchema = Schema.Struct({
  schemaVersion: Schema.String,
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

/**
 * Failed to encode a Float32Array into a binary buffer. Should not happen under normal operation —
 * typically indicates an internal inconsistency.
 */
export class VectorEncodeError extends Data.TaggedError("VectorEncodeError")<{
  readonly message: string
  readonly dtype: EmbeddingDtype
}> {}

/**
 * An EmbeddingDtype string value is not recognised. This should not happen if the type-system
 * exhaustiveness check is working correctly; the error is treated as a defect.
 */
export class UnknownEmbeddingDtypeError extends Data.TaggedError("UnknownEmbeddingDtypeError")<{
  readonly message: string
}> {}
