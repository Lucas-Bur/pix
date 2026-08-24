import { expect, it } from "vitest"

import {
  DEFAULT_SCOUT_SEQUENCE,
  SCOUT_SEQUENCES,
  SCOUT_SEQUENCE_NAMES,
  describeScoutSequence,
  radicalInverse,
  resolveScoutSequence,
  scoutLevelIndex,
  sobolUnitPoint,
} from "../retrieval/evaluation/scouts/index.js"
import type { ScoutSequence } from "../retrieval/evaluation/scouts/index.js"

it("resolves the scout sequence knob with halton as the default", () => {
  expect(DEFAULT_SCOUT_SEQUENCE).toBe("halton")
  expect(resolveScoutSequence(undefined)).toBe("halton")
  for (const name of SCOUT_SEQUENCE_NAMES) {
    expect(resolveScoutSequence(name)).toBe(name)
  }
  expect(() => resolveScoutSequence("golden")).toThrow(/PIX_BENCH_SCOUT_SEQUENCE/)
})

it("computes radical inverses for the halton primes", () => {
  expect(radicalInverse(1, 2)).toBeCloseTo(0.5, 12)
  expect(radicalInverse(2, 2)).toBeCloseTo(0.25, 12)
  expect(radicalInverse(3, 2)).toBeCloseTo(0.75, 12)
  expect(radicalInverse(1, 3)).toBeCloseTo(1 / 3, 12)
})

it("gives every sequence a report description", () => {
  for (const name of SCOUT_SEQUENCE_NAMES) {
    expect(describeScoutSequence(name).length).toBeGreaterThan(0)
    expect(SCOUT_SEQUENCES[name].description).toBe(describeScoutSequence(name))
  }
})

const expectContract = (sequence: ScoutSequence, count: number, parameterCount: number): void => {
  const first = sequence.points(count, parameterCount)
  expect(first).toEqual(sequence.points(count, parameterCount))
  expect(first.length).toBe(count)
  for (const point of first) {
    expect(point.length).toBe(parameterCount)
    for (const value of point) {
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThan(1)
    }
  }
}

it("satisfies the shared scout contract for every sequence", () => {
  for (const sequence of Object.values(SCOUT_SEQUENCES)) {
    expectContract(sequence, 64, 35)
  }
})

it("keeps halton and sobol parameter limits while random is unlimited", () => {
  expect(SCOUT_SEQUENCES.halton.maxParameters).toBe(35)
  expect(SCOUT_SEQUENCES.sobol.maxParameters).toBe(40)
  expect(SCOUT_SEQUENCES.random.maxParameters).toBe(Number.POSITIVE_INFINITY)
  expect(() => SCOUT_SEQUENCES.halton.points(4, 36)).toThrow(/parameter/)
  expect(() => sobolUnitPoint(0, 40)).toThrow(/dimension/)
})

it("stratifies the first 2^k sobol points into disjoint dyadic intervals", () => {
  for (const dimension of [0, 1, 17, 39]) {
    const seen = new Set<number>()
    for (let index = 0; index < 64; index++) {
      seen.add(Math.floor(sobolUnitPoint(index, dimension) * 64))
    }
    expect(seen.size).toBe(64)
  }
})

it("produces distinct unit points before level quantization", () => {
  const points = SCOUT_SEQUENCES.sobol.points(64, 35)
  const keys = points.map((point) => point.join(","))
  expect(new Set(keys).size).toBe(points.length)
})

it("maps unit coordinates onto bounded discrete levels", () => {
  expect(scoutLevelIndex(0, 10)).toBe(0)
  expect(scoutLevelIndex(0.999, 10)).toBe(9)
  expect(scoutLevelIndex(0.5, 1)).toBe(0)
  for (let index = 0; index < 100; index++) {
    const level = scoutLevelIndex(SCOUT_SEQUENCES.halton.points(100, 7)[index]![3]!, 21)
    expect(level).toBeGreaterThanOrEqual(0)
    expect(level).toBeLessThanOrEqual(20)
  }
})
