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
 *
 * Implementation notes:
 *
 * - Uses `Object.create(null)` for the accumulator maps so names like `constructor` or `__proto__`
 *   don't collide with inherited Object.prototype members (which would return the `Object`
 *   constructor or `Object.prototype.toString` and crash the lookup).
 * - Uses `Set<number>` per name to deduplicate chunk indices. The same identifier can appear in
 *   multiple identifiers in the same chunk (or be re-extracted from overlapping chunks), and the
 *   scorers expect a flat set of unique chunks per name.
 */
export const buildIdentifierIndex = (identifiers: readonly Identifier[]): IdentifierIndexMaps => {
  const exact = Object.create(null) as Record<string, Set<number>>
  const split = Object.create(null) as Record<string, Set<number>>

  const add = (index: Record<string, Set<number>>, key: string, chunkIndex: number): void => {
    const bucket = index[key] ?? new Set<number>()
    bucket.add(chunkIndex)
    index[key] = bucket
  }

  for (const id of identifiers) {
    const name = id.name.toLowerCase()
    add(exact, name, id.chunkIndex)

    for (const word of splitIdentifier(id.name)) {
      add(split, word, id.chunkIndex)
    }
  }

  const toRecord = (m: Record<string, Set<number>>): Record<string, readonly number[]> => {
    const out: Record<string, number[]> = {}
    for (const k of Object.keys(m)) out[k] = [...m[k]!]
    return out
  }

  return { exact: toRecord(exact), split: toRecord(split) }
}

/** Remap retained identifier postings and merge indexes extracted for new chunks. */
export const rebuildIdentifierIndex = (
  previous: IdentifierIndexMaps | null,
  retainedIndexes: ReadonlyMap<number, number>,
  added: IdentifierIndexMaps,
): IdentifierIndexMaps => {
  const rebuildMap = (
    oldMap: Readonly<Record<string, readonly number[]>>,
    addedMap: Readonly<Record<string, readonly number[]>>,
  ): Record<string, readonly number[]> => {
    const result: Record<string, Set<number>> = Object.create(null)
    for (const [name, indexes] of Object.entries(oldMap)) {
      for (const oldIndex of indexes) {
        const newIndex = retainedIndexes.get(oldIndex)
        if (newIndex === undefined) continue
        const bucket = result[name] ?? new Set<number>()
        bucket.add(newIndex)
        result[name] = bucket
      }
    }
    for (const [name, indexes] of Object.entries(addedMap)) {
      const bucket = result[name] ?? new Set<number>()
      for (const index of indexes) bucket.add(index)
      result[name] = bucket
    }
    return Object.fromEntries(
      Object.entries(result).map(([name, indexes]) => [name, [...indexes].sort((a, b) => a - b)]),
    )
  }

  return {
    exact: rebuildMap(previous?.exact ?? {}, added.exact),
    split: rebuildMap(previous?.split ?? {}, added.split),
  }
}
