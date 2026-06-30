import type { Identifier } from "../../domain/identifier.js"
import { splitIdentifier } from "../parsing/split-identifier.js"

export interface IdentifierIndexMaps {
  /** Lowercased full identifier name -> chunks where it appears. */
  readonly exact: ReadonlyMap<string, readonly number[]>
  /** Lowercased constituent word -> chunks where any identifier containing it appears. */
  readonly split: ReadonlyMap<string, readonly number[]>
}

/**
 * Build the two-map identifier index from a flat list of extracted identifiers. Aggregates chunk
 * indices per name (exact) and per constituent word (split). Both maps use lowercased keys so the
 * query-time scorers can do case-insensitive lookups in O(1).
 */
export const buildIdentifierIndex = (identifiers: readonly Identifier[]): IdentifierIndexMaps => {
  const exact = new Map<string, number[]>()
  const split = new Map<string, number[]>()

  for (const id of identifiers) {
    // exact map
    const name = id.name.toLowerCase()
    const exactList = exact.get(name)
    if (exactList === undefined) {
      exact.set(name, [id.chunkIndex])
    } else {
      exactList.push(id.chunkIndex)
    }

    // split map -- one entry per constituent word
    for (const word of splitIdentifier(id.name)) {
      const splitList = split.get(word)
      if (splitList === undefined) {
        split.set(word, [id.chunkIndex])
      } else {
        splitList.push(id.chunkIndex)
      }
    }
  }

  return { exact, split }
}
