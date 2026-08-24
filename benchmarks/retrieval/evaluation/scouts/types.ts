export const SCOUT_SEQUENCE_NAMES = ["halton", "sobol", "random"] as const

/** Deterministic low-discrepancy sequence used for router beam starting points. */
export type ScoutSequenceName = (typeof SCOUT_SEQUENCE_NAMES)[number]

/** One deterministic way to spread beam starting points across the search space. */
export interface ScoutSequence {
  readonly name: ScoutSequenceName
  /** Human-readable construction summary rendered into benchmark reports. */
  readonly description: string
  /** Maximum supported parameter count; `Infinity` when unlimited. */
  readonly maxParameters: number
  /**
   * First `count` unit-interval starting points, each with `parameterCount` coordinates in `[0,
   * 1)`. Pure: repeated calls return identical points.
   */
  points(count: number, parameterCount: number): readonly (readonly number[])[]
}

/** Quantize one unit-interval coordinate onto one of `length` discrete levels. */
export const scoutLevelIndex = (unit: number, length: number): number =>
  Math.min(length - 1, Math.floor(unit * length))
