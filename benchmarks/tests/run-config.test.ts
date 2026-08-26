import { expect, it } from "vitest"

import { resolveRouterSearchStrategy, resolveSearchKnobs } from "../retrieval/run-config.js"

it("resolves search knobs with strategy defaults", () => {
  const knobs = resolveSearchKnobs({})
  expect(knobs).toEqual({
    routerSearchStrategy: "halving-funnel",
    scoutSequence: "halton",
    seedHypotheses: true,
    beamSchedule: "fixed",
    coordinatePasses: 2,
    globalScouts: 512,
    localCloudPoints: 16,
    localCloudRadiusLevels: 2,
  })
})

it("parses overrides and rejects invalid values by knob name", () => {
  expect(
    resolveSearchKnobs({
      PIX_BENCH_ROUTER_STRATEGY: "successive-halving",
      PIX_BENCH_SCOUT_SEQUENCE: "sobol",
      PIX_BENCH_SEED_HYPOTHESES: "1",
      PIX_BENCH_BEAM_SCHEDULE: "decaying",
      PIX_BENCH_COORDINATE_PASSES: "0",
      PIX_BENCH_GLOBAL_SCOUTS: "256",
      PIX_BENCH_LOCAL_CLOUD_POINTS: "64",
      PIX_BENCH_LOCAL_CLOUD_RADIUS: "2",
    }),
  ).toEqual({
    routerSearchStrategy: "successive-halving",
    scoutSequence: "sobol",
    seedHypotheses: true,
    beamSchedule: "decaying",
    coordinatePasses: 0,
    globalScouts: 256,
    localCloudPoints: 64,
    localCloudRadiusLevels: 2,
  })
  expect(() => resolveRouterSearchStrategy("golden")).toThrow(/PIX_BENCH_ROUTER_STRATEGY/)
  expect(() => resolveSearchKnobs({ PIX_BENCH_BEAM_SCHEDULE: "wide" })).toThrow(
    /PIX_BENCH_BEAM_SCHEDULE/,
  )
  expect(() => resolveSearchKnobs({ PIX_BENCH_GLOBAL_SCOUTS: "-4" })).toThrow(
    /PIX_BENCH_GLOBAL_SCOUTS/,
  )
  expect(() =>
    resolveSearchKnobs({ PIX_BENCH_LOCAL_CLOUD_POINTS: "8", PIX_BENCH_LOCAL_CLOUD_RADIUS: "0" }),
  ).toThrow(/PIX_BENCH_LOCAL_CLOUD_RADIUS/)
})

it("uses the measured broad-wave defaults for the halving funnel", () => {
  expect(resolveSearchKnobs({ PIX_BENCH_ROUTER_STRATEGY: "halving-funnel" })).toMatchObject({
    routerSearchStrategy: "halving-funnel",
    globalScouts: 512,
    seedHypotheses: true,
    localCloudPoints: 16,
    localCloudRadiusLevels: 2,
  })
})
