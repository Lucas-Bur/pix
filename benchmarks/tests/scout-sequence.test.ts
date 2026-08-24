import { expect, it } from "vitest"

import {
  DEFAULT_SCOUT_SEQUENCE,
  MAX_SOBOL_DIMENSIONS,
  SCOUT_SEQUENCE_NAMES,
  radicalInverse,
  resolveScoutSequence,
  scoutLevelIndex,
  sobolUnitPoints,
  sobolUnitPoint,
} from "../retrieval/evaluation/scout-sequence.js"

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

it("builds deterministic sobol points", () => {
  const first = sobolUnitPoints(64, 35)
  const second = sobolUnitPoints(64, 35)
  expect(first).toEqual(second)
})

it("keeps every sobol coordinate inside the unit interval", () => {
  for (const point of sobolUnitPoints(256, MAX_SOBOL_DIMENSIONS)) {
    for (const value of point) {
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThan(1)
    }
  }
})

it("stratifies the first 2^k sobol points into disjoint dyadic intervals", () => {
  for (const dimension of [0, 1, 17, MAX_SOBOL_DIMENSIONS - 1]) {
    const seen = new Set<number>()
    for (const point of sobolUnitPoints(64, dimension + 1)) {
      seen.add(Math.floor(point[dimension]! * 64))
    }
    expect(seen.size).toBe(64)
  }
})

it("starts every sobol dimension at zero and reaches the first dyadic step at index 1", () => {
  for (let dimension = 0; dimension < MAX_SOBOL_DIMENSIONS; dimension++) {
    expect(sobolUnitPoint(0, dimension)).toBe(0)
  }
  expect(sobolUnitPoint(1, 0)).toBeCloseTo(0.5, 12)
})

it("produces distinct unit points before level quantization", () => {
  const points = sobolUnitPoints(64, 35)
  const keys = points.map((point) => point.join(","))
  expect(new Set(keys).size).toBe(points.length)
})

it("rejects sobol dimensions beyond the supported maximum", () => {
  expect(() => sobolUnitPoint(0, MAX_SOBOL_DIMENSIONS)).toThrow(/dimension/)
})

it("maps unit coordinates onto bounded discrete levels", () => {
  expect(scoutLevelIndex(0, 10)).toBe(0)
  expect(scoutLevelIndex(0.999, 10)).toBe(9)
  expect(scoutLevelIndex(0.5, 1)).toBe(0)
  for (let index = 0; index < 100; index++) {
    const level = scoutLevelIndex(sobolUnitPoint(index, 7), 21)
    expect(level).toBeGreaterThanOrEqual(0)
    expect(level).toBeLessThanOrEqual(20)
  }
})
