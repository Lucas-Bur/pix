import { tokenize } from "./tokenize.js"

const WEIGHT_IDENTITY = 3.0
const WEIGHT_CAMELCASE = 1.5
const WEIGHT_BM25 = 1.0
const WEIGHT_DENSE = 1.0

const SHORT_QUERY_MAX = 2
const LONG_QUERY_MIN = 8

/** Weights applied to the four production retrieval channels before RRF fusion. */
export interface RetrievalWeights {
  readonly identity: number
  readonly camelcase: number
  readonly bm25: number
  readonly dense: number
}

/** Route a query to the production RRF channel weights using its token count. */
export const routeQuery = (queryText: string): RetrievalWeights => {
  const count = tokenize(queryText).length
  if (count <= SHORT_QUERY_MAX) {
    return { identity: WEIGHT_IDENTITY, camelcase: WEIGHT_CAMELCASE, bm25: 1.5, dense: 0.5 }
  }
  if (count >= LONG_QUERY_MIN) {
    return { identity: WEIGHT_IDENTITY, camelcase: WEIGHT_CAMELCASE, bm25: 0.5, dense: 1.5 }
  }
  return {
    identity: WEIGHT_IDENTITY,
    camelcase: WEIGHT_CAMELCASE,
    bm25: WEIGHT_BM25,
    dense: WEIGHT_DENSE,
  }
}
