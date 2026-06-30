import type { RankedChunk } from "../../domain/ports.js"

/**
 * Index data consumed by the identity and camelCase scoring channels. Maps a lowercased identifier
 * name (or constituent word) to the chunks where it appears.
 */
export type IdentifierIndex = ReadonlyMap<string, readonly number[]>

/**
 * Score chunks by exact identifier-name match.
 *
 * If the query (lowercased) matches an index key (lowercased) exactly, every chunk associated with
 * that identifier receives a score of 1.0. The RRF weight in fuseResults determines the final
 * channel influence -- not the per-scorer score itself.
 *
 * The index is expected to be pre-lowercased (the indexer normalizes at write time). This keeps the
 * lookup O(1) without re-traversing the map.
 */
export const rankIdentity = (queryText: string, index: IdentifierIndex): readonly RankedChunk[] => {
  if (queryText === "") return []
  const chunks = index.get(queryText.toLowerCase())
  if (chunks === undefined) return []
  return chunks.map((chunkIndex) => ({ chunkIndex, score: 1.0 }))
}
