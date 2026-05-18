import { tokenize } from "./tokenize.js"

const SHORT_QUERY_MAX = 2
const LONG_QUERY_MIN = 8

export const routeQuery = (queryText: string): { bm25: number; dense: number } => {
  const count = tokenize(queryText).length
  if (count <= SHORT_QUERY_MAX) return { bm25: 1.5, dense: 0.5 }
  if (count >= LONG_QUERY_MIN) return { bm25: 0.5, dense: 1.5 }
  return { bm25: 1.0, dense: 1.0 }
}
