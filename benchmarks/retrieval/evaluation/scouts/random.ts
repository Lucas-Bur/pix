import type { ScoutSequence } from "./types.js"

const RANDOM_SEARCH_SEED = 1

/** One xorshift32 step returning the next state and its `[0, 1)` fraction. */
const nextRandom = (state: number): readonly [number, number] => {
  let next = state | 0
  next ^= next << 13
  next ^= next >>> 17
  next ^= next << 5
  const unsigned = next >>> 0
  return [unsigned, unsigned / 4_294_967_296]
}

/**
 * Random starting points drawn sequentially from a fixed-seed xorshift generator, so every run with
 * the same seed produces the same points.
 */
export const randomScoutSequence: ScoutSequence = {
  name: "random",
  description: "fixed-seed xorshift draws",
  maxParameters: Number.POSITIVE_INFINITY,
  points: (count, parameterCount) => {
    const points: number[][] = []
    let state: number = RANDOM_SEARCH_SEED
    for (let pointIndex = 0; pointIndex < count; pointIndex++) {
      const point: number[] = []
      for (let parameterIndex = 0; parameterIndex < parameterCount; parameterIndex++) {
        const [next, unit] = nextRandom(state)
        state = next
        point.push(unit)
      }
      points.push(point)
    }
    return points
  },
}
