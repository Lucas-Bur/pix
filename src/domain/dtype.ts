import { Data } from "effect"

export type EmbeddingDtype = "fp32" | "fp16" | "q8" | "q4"

export interface IndexMeta {
  readonly schemaVersion: string
  readonly dtype: EmbeddingDtype
  readonly dims: number
  readonly model: string
  readonly lastIndex: number
}

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
