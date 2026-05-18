import { tokenize } from "./tokenize.js"

export const bm25Weight = (queryText: string): number => {
  const count = tokenize(queryText).length
  if (count <= 2) return 1.5
  if (count >= 8) return 0.5
  return 1.0
}

export const denseWeight = (queryText: string): number => {
  const count = tokenize(queryText).length
  if (count <= 2) return 0.5
  if (count >= 8) return 1.5
  return 1.0
}
