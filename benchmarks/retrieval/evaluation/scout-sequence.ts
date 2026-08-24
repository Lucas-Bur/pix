/**
 * Benchmark-only deterministic global-scout sequences seeding the router beam search.
 *
 * The scouts spread starting configurations across the router coefficient space before coordinate
 * refinement begins. All sequences are pure functions so an artifact can be reproduced from the
 * selected sequence name alone.
 */

export const SCOUT_SEQUENCE_NAMES = ["halton", "sobol", "random"] as const

/** Deterministic low-discrepancy sequence used for global router scouts. */
export type ScoutSequenceName = (typeof SCOUT_SEQUENCE_NAMES)[number]

/** One-line construction summary rendered into benchmark reports. */
const SCOUT_SEQUENCE_DESCRIPTIONS: Readonly<Record<ScoutSequenceName, string>> = {
  halton: "digit-reversal points, one prime base per parameter",
  sobol: "Gray-code low-discrepancy points from primitive polynomials",
  random: "fixed-seed xorshift draws",
}

/** Human-readable construction of one scout sequence for reports and artifacts. */
export const describeScoutSequence = (name: ScoutSequenceName): string =>
  SCOUT_SEQUENCE_DESCRIPTIONS[name]

/** Sequence used unless `PIX_BENCH_SCOUT_SEQUENCE` requests another one. */
export const DEFAULT_SCOUT_SEQUENCE: ScoutSequenceName = "halton"

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

/** Fixed working precision of the Sobol direction integers (31 usable bits). */
const SOBOL_BITS = 31

/** Supported Sobol dimensions: dimension 0 plus 39 primitive-polynomial dimensions. */
export const MAX_SOBOL_DIMENSIONS = 40

/**
 * Prime factorizations of `2^degree - 1` for degrees 2..8, used by the primitivity test. Mersenne
 * numbers up to 2^8 - 1 factor over tiny primes only.
 */
const MERSENNE_PRIME_FACTORS: Readonly<Record<number, readonly number[]>> = {
  3: [3],
  7: [7],
  15: [3, 5],
  31: [31],
  63: [3, 7],
  127: [127],
  255: [3, 5, 17],
}

/** Reduce a GF(2) polynomial bitmask modulo `modulus`. */
const reduceMod = (value: number, modulus: number): number => {
  let result = value
  const modulusDegree = 31 - Math.clz32(modulus)
  for (let degree = 31 - Math.clz32(result); degree >= modulusDegree; degree--) {
    if (((result >>> degree) & 1) !== 0) result ^= modulus << (degree - modulusDegree)
  }
  return result
}

/** Carry-less multiplication modulo a GF(2) polynomial represented as bitmask. */
const multiplyMod = (left: number, right: number, modulus: number): number => {
  let accumulator = 0
  let addend = left
  let multiplier = right
  while (multiplier > 0) {
    if ((multiplier & 1) !== 0) accumulator ^= addend
    addend <<= 1
    multiplier >>>= 1
  }
  return reduceMod(accumulator, modulus)
}

/** Exponentiate `x` (= bit 1) to `exponent` in GF(2)[x]/modulus. */
const powerXMod = (exponent: number, modulus: number): number => {
  let result = 1
  let base = 1
  let remaining = exponent
  while (remaining > 0) {
    if ((remaining & 1) !== 0) result = multiplyMod(result, base, modulus)
    base = multiplyMod(base, base, modulus)
    remaining >>>= 1
  }
  return result
}

/** Whether the polynomial `x^degree + modulus` (modulus = low bits) is primitive over GF(2). */
const isPrimitivePolynomial = (modulus: number, degree: number): boolean => {
  const order = 2 ** degree - 1
  if (powerXMod(order, modulus) !== 1) return false
  for (const prime of MERSENNE_PRIME_FACTORS[degree] ?? []) {
    if (powerXMod(order / prime, modulus) === 1) return false
  }
  return true
}

/**
 * Primitive polynomials `x^degree + c_{degree-1} x^{degree-1} + ... + 1` in ascending bitmask
 * order, enough to cover `MAX_SOBOL_DIMENSIONS` dimensions deterministically.
 */
const primitivePolynomials = (): readonly number[] => {
  const polynomials: number[] = []
  for (let degree = 2; polynomials.length < MAX_SOBOL_DIMENSIONS - 1 && degree <= 8; degree++) {
    for (let candidate = (1 << degree) + 1; candidate < 1 << (degree + 1); candidate += 2) {
      if (polynomials.length >= MAX_SOBOL_DIMENSIONS - 1) break
      if (isPrimitivePolynomial(candidate, degree)) polynomials.push(candidate)
    }
  }
  if (polynomials.length < MAX_SOBOL_DIMENSIONS - 1) {
    throw new Error("Sobol construction found too few primitive polynomials")
  }
  return polynomials
}

/**
 * Direction integers per dimension: `table[dimension][k]` is `V_{k+1}` scaled by 2^31. Dimension 0
 * uses the base-2 Van der Corput initialization (`V_k = 2^-k`); later dimensions derive their
 * recurrence from successive primitive polynomials `x^s + a1 x^{s-1} + ... + 1` with deterministic
 * odd initialization `m_k = 2k - 1` (`m_k < 2^k` keeps the generator matrix triangular, preserving
 * the net property) and the standard Sobol recurrence `m_i = m_{i-s} XOR (m_{i-s} << s) XOR sum_j
 * 2^j a_j m_{i-j}`.
 */
const buildDirectionTable = (): readonly (readonly number[])[] => {
  const table: number[][] = [
    Array.from({ length: SOBOL_BITS }, (_, index) => 1 << (SOBOL_BITS - 1 - index)),
  ]
  for (const polynomial of primitivePolynomials()) {
    const degree = 31 - Math.clz32(polynomial)
    const initialValues: number[] = []
    for (let index = 1; index <= SOBOL_BITS; index++) {
      if (index <= degree) {
        initialValues.push(2 * index - 1)
        continue
      }
      const previous = initialValues[index - 1]!
      let next = initialValues[index - degree - 1]!
      next ^= previous << degree
      for (let tap = 1; tap <= degree - 1; tap++) {
        if ((polynomial >>> (degree - tap)) & 1) {
          next ^= initialValues[index - tap - 1]! << tap
        }
      }
      initialValues.push(next)
    }
    table.push(initialValues.map((value, index) => value << (SOBOL_BITS - 1 - index)))
  }
  return table
}

const SOBOL_DIRECTION_TABLE = buildDirectionTable()

/** Single Sobol coordinate: 0-based `index`-th point of `dimension`, inside `[0, 1)`. */
export const sobolUnitPoint = (index: number, dimension: number): number => {
  const directions = SOBOL_DIRECTION_TABLE[dimension]
  if (directions === undefined) {
    throw new Error(
      `Sobol dimension ${dimension} exceeds supported maximum ${MAX_SOBOL_DIMENSIONS}`,
    )
  }
  const grayCode = index ^ (index >>> 1)
  let value = 0
  for (let bit = 0; bit < SOBOL_BITS; bit++) {
    if (((grayCode >>> bit) & 1) !== 0) value ^= directions[bit]!
  }
  return value / 2 ** SOBOL_BITS
}

/** First `count` Sobol points across `dimensions` coordinates. */
export const sobolUnitPoints = (
  count: number,
  dimensions: number,
): readonly (readonly number[])[] =>
  Array.from({ length: count }, (_, index) =>
    Array.from({ length: dimensions }, (_, dimension) => sobolUnitPoint(index, dimension)),
  )

/** Quantize a unit-interval coordinate onto one of `length` discrete levels. */
export const scoutLevelIndex = (unit: number, length: number): number =>
  Math.min(length - 1, Math.floor(unit * length))
