import { tokenize } from "./tokenize.js"

export const routeQuery = (queryText: string): { bm25: number; dense: number } => {
  const count = tokenize(queryText).length
  if (count <= 2) return { bm25: 1.5, dense: 0.5 }
  if (count >= 8) return { bm25: 0.5, dense: 1.5 }
  return { bm25: 1.0, dense: 1.0 }
}
