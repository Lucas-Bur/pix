import { expect, it } from "vitest"

import { resolveSearchKnobs } from "../retrieval/run-config.js"

it("resolves search knobs with strategy defaults", () => {
  const knobs = resolveSearchKnobs({})
  expect(knobs).toEqual({
    scoutSequence: "sobol",
    seedHypotheses: true,
    globalScouts: 512,
    localCloudPoints: 16,
    localCloudRadiusLevels: 2,
  })
})

it("parses overrides and rejects invalid values by knob name", () => {
  expect(
    resolveSearchKnobs({
      PIX_BENCH_SCOUT_SEQUENCE: "halton",
      PIX_BENCH_SEED_HYPOTHESES: "1",
      PIX_BENCH_GLOBAL_SCOUTS: "256",
      PIX_BENCH_LOCAL_CLOUD_POINTS: "64",
      PIX_BENCH_LOCAL_CLOUD_RADIUS: "2",
    }),
  ).toEqual({
    scoutSequence: "halton",
    seedHypotheses: true,
    globalScouts: 256,
    localCloudPoints: 64,
    localCloudRadiusLevels: 2,
  })
  expect(() => resolveSearchKnobs({ PIX_BENCH_SCOUT_SEQUENCE: "golden" })).toThrow(
    /PIX_BENCH_SCOUT_SEQUENCE/,
  )
  expect(() => resolveSearchKnobs({ PIX_BENCH_GLOBAL_SCOUTS: "-4" })).toThrow(
    /PIX_BENCH_GLOBAL_SCOUTS/,
  )
  expect(() =>
    resolveSearchKnobs({ PIX_BENCH_LOCAL_CLOUD_POINTS: "8", PIX_BENCH_LOCAL_CLOUD_RADIUS: "0" }),
  ).toThrow(/PIX_BENCH_LOCAL_CLOUD_RADIUS/)
})

it("uses the measured broad-wave defaults for the halving funnel", () => {
  expect(resolveSearchKnobs({})).toMatchObject({
    globalScouts: 512,
    seedHypotheses: true,
    localCloudPoints: 16,
    localCloudRadiusLevels: 2,
  })
})
