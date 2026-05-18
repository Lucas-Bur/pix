import type { RankedChunk } from "../domain/ports.js"

const K = 60

export interface RrfResult {
  readonly chunkIndex: number
  readonly score: number
}

export const rrfFuse = (
  rankedLists: readonly (readonly RankedChunk[])[],
  weights: readonly number[],
): RrfResult[] => {
  const scoreMap = new Map<number, number>()

  for (let p = 0; p < rankedLists.length; p++) {
    const list = rankedLists[p]
    const w = weights[p]
    for (let rank = 0; rank < list.length; rank++) {
      const { chunkIndex } = list[rank]
      const contribution = w * (1 / (K + rank + 1))
      scoreMap.set(chunkIndex, (scoreMap.get(chunkIndex) ?? 0) + contribution)
    }
  }

  const results: RrfResult[] = []
  for (const [chunkIndex, score] of scoreMap) {
    results.push({ chunkIndex, score })
  }
  results.sort((a, b) => b.score - a.score)
  return results
}
