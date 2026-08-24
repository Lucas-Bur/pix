import { expect, it } from "vitest"

import { resolveRouterSearchStrategy, resolveSearchKnobs } from "../retrieval/run-config.js"

it("resolves search knobs with strategy defaults", () => {
  const knobs = resolveSearchKnobs({})
  expect(knobs).toEqual({
    routerSearchStrategy: "proxy-promotion",
    scoutSequence: "halton",
    seedHypotheses: false,
    beamSchedule: "fixed",
    coordinatePasses: 2,
    globalScouts: 64,
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
    }),
  ).toEqual({
    routerSearchStrategy: "successive-halving",
    scoutSequence: "sobol",
    seedHypotheses: true,
    beamSchedule: "decaying",
    coordinatePasses: 0,
    globalScouts: 256,
  })
  expect(() => resolveRouterSearchStrategy("golden")).toThrow(/PIX_BENCH_ROUTER_STRATEGY/)
  expect(() => resolveSearchKnobs({ PIX_BENCH_BEAM_SCHEDULE: "wide" })).toThrow(
    /PIX_BENCH_BEAM_SCHEDULE/,
  )
  expect(() => resolveSearchKnobs({ PIX_BENCH_GLOBAL_SCOUTS: "-4" })).toThrow(
    /PIX_BENCH_GLOBAL_SCOUTS/,
  )
})
