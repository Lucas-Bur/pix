import { Schema } from "effect"

import type { IdentifierIndexMaps } from "../../domain/identifier-index.js"
import type { Identifier } from "../../domain/identifier.js"
import { splitIdentifier } from "../parsing/split-identifier.js"

/** Effect Schema for the JSON-serializable form of the identifier index. */
const IdentifierIndexSchema = Schema.Struct({
  exact: Schema.Record(Schema.String, Schema.Array(Schema.Number)),
  split: Schema.Record(Schema.String, Schema.Array(Schema.Number)),
})

/** Serialize the identifier index maps to a JSON string for .pix/identifiers.json. */
export const serializeIdentifierIndex = (maps: IdentifierIndexMaps): string =>
  Schema.encodeSync(Schema.fromJsonString(IdentifierIndexSchema))(maps)

/**
 * Deserialize the JSON contents of .pix/identifiers.json back to the maps shape. Throws on
 * corruption.
 */
export const deserializeIdentifierIndex = (content: string): IdentifierIndexMaps =>
  Schema.decodeUnknownSync(Schema.fromJsonString(IdentifierIndexSchema))(content)

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
