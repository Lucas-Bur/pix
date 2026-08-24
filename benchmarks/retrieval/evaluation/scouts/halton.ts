import type { ScoutSequence } from "./types.js"

/** First 35 primes: one Halton base per router coefficient parameter. */
const HALTON_PRIMES = [
  2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41, 43, 47, 53, 59, 61, 67, 71, 73, 79, 83, 89, 97,
  101, 103, 107, 109, 113, 127, 131, 137, 139, 149,
] as const

/** Van der Corput-style digit reversal of `index` in base `base`. */
export const radicalInverse = (index: number, base: number): number => {
  let remaining = index
  let place = 1 / base
  let result = 0
  while (remaining > 0) {
    result += (remaining % base) * place
    remaining = Math.floor(remaining / base)
    place /= base
  }
  return result
}

/** Halton starting points; point `i` uses digit reversals of `i + 1`, skipping the origin. */
export const haltonScoutSequence: ScoutSequence = {
  name: "halton",
  description: "digit-reversal points, one prime base per parameter",
  maxParameters: HALTON_PRIMES.length,
  points: (count, parameterCount) =>
    Array.from({ length: count }, (_, pointIndex) =>
      Array.from({ length: parameterCount }, (_, parameterIndex) => {
        const prime = HALTON_PRIMES[parameterIndex]
        if (prime === undefined) {
          throw new Error(`Halton sequence has no prime for parameter ${parameterIndex}`)
        }
        return radicalInverse(pointIndex + 1, prime)
      }),
    ),
}
