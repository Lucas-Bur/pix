import type { RankedChunk } from "../../domain/ports.js"
import { splitIdentifier } from "../parsing/split-identifier.js"
import type { IdentifierIndex } from "./identity.js"

/**
 * Score chunks by camelCase constituent-word match.
 *
 * Splits the query into constituent words via splitIdentifier (handles camelCase, snake_case,
 * kebab-case, acronym boundaries) and accumulates scores per chunk: a chunk gets +1 for each
 * constituent word that appears in its identifier. The RRF weight in fuseResults determines the
 * final channel influence -- not the per-scorer score itself.
 *
 * Like rankIdentity, the index is expected to be pre-lowercased.
 */
export const rankCamelCase = (
  queryText: string,
  index: IdentifierIndex,
): readonly RankedChunk[] => {
  const words = splitIdentifier(queryText)
  if (words.length === 0) return []

  const scores = new Map<number, number>()
  for (const word of words) {
    const chunks = index.split[word]
    if (chunks === undefined) continue
    // Deduplicate per query word: the index stores the same chunkIndex
    // multiple times when several identifiers in the same chunk share a
    // constituent word, but a single query term should contribute at most
    // one hit per chunk.
    for (const chunkIndex of new Set(chunks)) {
      scores.set(chunkIndex, (scores.get(chunkIndex) ?? 0) + 1)
    }
  }

  const results: RankedChunk[] = []
  for (const [chunkIndex, score] of scores) {
    results.push({ chunkIndex, score })
  }
  results.sort((a, b) => b.score - a.score)
  return results
}
