import { Data, Schema } from "effect"

export type EmbeddingDtype = "fp32" | "fp16" | "q8" | "q4"

export const IndexMetaSchema = Schema.Struct({
  schemaVersion: Schema.String,
  dtype: Schema.Literal("fp32", "fp16", "q8", "q4"),
  dims: Schema.Number,
  model: Schema.String,
  lastIndex: Schema.Number,
})

/** Domain type inferred from IndexMetaSchema. */
export type IndexMeta = typeof IndexMetaSchema.Type

export class DtypeMismatchError extends Data.TaggedError("DtypeMismatchError")<{
  readonly message: string
  readonly storedDtype: EmbeddingDtype
  readonly configDtype: EmbeddingDtype
}> {}

export class VectorDecodeError extends Data.TaggedError("VectorDecodeError")<{
  readonly message: string
  readonly dtype: EmbeddingDtype
}> {}

export class VectorEncodeError extends Data.TaggedError("VectorEncodeError")<{
  readonly message: string
  readonly dtype: EmbeddingDtype
}> {}

export class UnknownEmbeddingDtypeError extends Data.TaggedError("UnknownEmbeddingDtypeError")<{
  readonly message: string
}> {}
