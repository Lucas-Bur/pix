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
