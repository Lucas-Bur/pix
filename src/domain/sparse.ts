/** Supported document encoder for learned sparse retrieval. */
export const SPARSE_DOCUMENT_MODEL =
  "raul3820/opensearch-neural-sparse-encoding-doc-v3-distill-onnx"

/** Pinned document-model revision used to make persisted sparse indexes reproducible. */
export const SPARSE_DOCUMENT_REVISION = "7c40813e0264f105bca4c16cdc721c3a84170d52"

/** Tokenizer and static query-IDF source paired with the document encoder. */
export const SPARSE_QUERY_MODEL =
  "opensearch-project/opensearch-neural-sparse-encoding-doc-v3-distill"

/** Pinned tokenizer and IDF revision paired with the document encoder. */
export const SPARSE_QUERY_REVISION = "babf71f3c48695e2e53a978208e8aba48335e3c0"

/** SHA-256 of the pinned query model's `idf.json` payload. */
export const SPARSE_IDF_CONTENT_HASH =
  "da23a1c0b9252776cc8c6d70fd14723e218f484d489cd9027ac6e4065d5b9edd"

/** One non-zero dimension in a learned sparse vector. */
export interface SparseTerm {
  readonly tokenId: number
  readonly weight: number
}

/** Variable-length sparse vector sorted by token ID. */
export interface SparseVector {
  readonly terms: readonly SparseTerm[]
}

/** Complete versioned contract required to reuse persisted sparse vectors safely. */
export interface SparseContract {
  readonly model: string
  readonly modelRevision: string
  readonly tokenizer: string
  readonly tokenizerRevision: string
  readonly idfRevision: string
  readonly idfContentHash: string
}

/** Tokenized sparse query together with the contract used by SQLite's static IDF lookup. */
export interface SparseQuery {
  readonly tokenIds: readonly number[]
  readonly contract: SparseContract
}

/** Compare two persisted sparse contracts field by field. */
export const sparseContractsEqual = (left: SparseContract, right: SparseContract): boolean =>
  left.model === right.model &&
  left.modelRevision === right.modelRevision &&
  left.tokenizer === right.tokenizer &&
  left.tokenizerRevision === right.tokenizerRevision &&
  left.idfRevision === right.idfRevision &&
  left.idfContentHash === right.idfContentHash
