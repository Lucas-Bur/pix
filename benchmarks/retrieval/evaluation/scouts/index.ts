import { haltonScoutSequence } from "./halton.js"
import { randomScoutSequence } from "./random.js"
import { sobolScoutSequence } from "./sobol.js"
import { SCOUT_SEQUENCE_NAMES, type ScoutSequence, type ScoutSequenceName } from "./types.js"

export type { ScoutSequence, ScoutSequenceName }
export { SCOUT_SEQUENCE_NAMES, scoutLevelIndex } from "./types.js"
export { radicalInverse } from "./halton.js"
export { sobolUnitPoint } from "./sobol.js"

/** All selectable scout sequences keyed by their benchmark knob value. */
export const SCOUT_SEQUENCES: Readonly<Record<ScoutSequenceName, ScoutSequence>> = {
  halton: haltonScoutSequence,
  sobol: sobolScoutSequence,
  random: randomScoutSequence,
}

/** Sequence used unless `PIX_BENCH_SCOUT_SEQUENCE` requests another one. */
export const DEFAULT_SCOUT_SEQUENCE: ScoutSequenceName = "halton"

/** Human-readable construction of one scout sequence for reports and artifacts. */
export const describeScoutSequence = (name: ScoutSequenceName): string =>
  SCOUT_SEQUENCES[name].description

const isScoutSequenceName = (requested: string): requested is ScoutSequenceName =>
  SCOUT_SEQUENCE_NAMES.some((name) => name === requested)

/** Resolve the `PIX_BENCH_SCOUT_SEQUENCE` benchmark knob, defaulting to Halton. */
export const resolveScoutSequence = (requested: string | undefined): ScoutSequenceName => {
  if (requested === undefined) return DEFAULT_SCOUT_SEQUENCE
  if (!isScoutSequenceName(requested)) {
    throw new Error(
      `Unknown PIX_BENCH_SCOUT_SEQUENCE value: ${requested}; expected one of ${SCOUT_SEQUENCE_NAMES.join(", ")}`,
    )
  }
  return requested
}
