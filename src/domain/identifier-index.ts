/**
 * Index data consumed by the identity and camelCase scoring channels. Maps a lowercased identifier
 * name (or constituent word) to the chunks where it appears. Uses plain Record (not ReadonlyMap)
 * for direct JSON-serializability at the storage boundary -- consistent with Bm25Index which uses
 * the same shape.
 */
export interface IdentifierIndexMaps {
  /** Lowercased full identifier name -> chunks where it appears. */
  readonly exact: Readonly<Record<string, readonly number[]>>
  /** Lowercased constituent word -> chunks where any identifier containing it appears. */
  readonly split: Readonly<Record<string, readonly number[]>>
}
