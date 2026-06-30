import type { IdentifierIndexMaps } from "../../domain/identifier-index.js"
import type { Identifier } from "../../domain/identifier.js"
import { splitIdentifier } from "../parsing/split-identifier.js"

/**
 * Build the two-map identifier index from a flat list of extracted identifiers. Aggregates chunk
 * indices per name (exact) and per constituent word (split). Both maps use lowercased keys so the
 * query-time scorers can do case-insensitive lookups in O(1).
 *
 * Returns plain Record shapes (not ReadonlyMap) for direct JSON serialization at the storage
 * boundary.
 */
export const buildIdentifierIndex = (identifiers: readonly Identifier[]): IdentifierIndexMaps => {
  const exact: Record<string, number[]> = {}
  const split: Record<string, number[]> = {}

  for (const id of identifiers) {
    // exact map
    const name = id.name.toLowerCase()
    const exactList = exact[name]
    if (exactList === undefined) {
      exact[name] = [id.chunkIndex]
    } else {
      exactList.push(id.chunkIndex)
    }

    // split map -- one entry per constituent word
    for (const word of splitIdentifier(id.name)) {
      const splitList = split[word]
      if (splitList === undefined) {
        split[word] = [id.chunkIndex]
      } else {
        splitList.push(id.chunkIndex)
      }
    }
  }

  return { exact, split }
}
