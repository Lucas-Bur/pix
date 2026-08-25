import { resolveScoutSequence, type ScoutSequenceName } from "./evaluation/scouts/index.js"
import {
  DEFAULT_ROUTER_SEARCH_STRATEGY,
  DEFAULT_ROUTER_SEARCH_STRATEGY_PARAMETERS,
  ROUTER_SEARCH_STRATEGY_NAMES,
  type RouterSearchStrategyName,
} from "./evaluation/types.js"

/** Benchmark-only search knobs resolved once per run from the environment. */
export interface SearchKnobs {
  readonly routerSearchStrategy: RouterSearchStrategyName
  readonly scoutSequence: ScoutSequenceName
  readonly seedHypotheses: boolean
  readonly beamSchedule: "fixed" | "decaying"
  readonly coordinatePasses: number
  readonly globalScouts: number
}

const isRouterSearchStrategyName = (requested: string): requested is RouterSearchStrategyName =>
  ROUTER_SEARCH_STRATEGY_NAMES.some((strategy) => strategy === requested)

/** Resolve `PIX_BENCH_ROUTER_STRATEGY`, defaulting to proxy promotion. */
export const resolveRouterSearchStrategy = (
  requested: string | undefined,
): RouterSearchStrategyName => {
  if (requested === undefined) return DEFAULT_ROUTER_SEARCH_STRATEGY
  if (!isRouterSearchStrategyName(requested)) {
    throw new Error(
      `Unknown PIX_BENCH_ROUTER_STRATEGY value: ${requested}; expected one of ${ROUTER_SEARCH_STRATEGY_NAMES.join(", ")}`,
    )
  }
  return requested
}

const parsePositiveInt = (envValue: string | undefined, name: string, fallback: number): number => {
  if (envValue === undefined) return fallback
  if (!/^\d+$/.test(envValue)) {
    throw new Error(`${name} must be an integer >= 0, got ${envValue}`)
  }
  return Number.parseInt(envValue, 10)
}

/** Resolve all search knobs from one environment; throws with the knob name on bad input. */
export const resolveSearchKnobs = (env: NodeJS.ProcessEnv): SearchKnobs => {
  const beamSchedule = env.PIX_BENCH_BEAM_SCHEDULE ?? "fixed"
  if (beamSchedule !== "fixed" && beamSchedule !== "decaying") {
    throw new Error(
      `Unknown PIX_BENCH_BEAM_SCHEDULE value: ${beamSchedule}; expected fixed or decaying`,
    )
  }
  return {
    routerSearchStrategy: resolveRouterSearchStrategy(env.PIX_BENCH_ROUTER_STRATEGY),
    scoutSequence: resolveScoutSequence(env.PIX_BENCH_SCOUT_SEQUENCE),
    seedHypotheses:
      env.PIX_BENCH_SEED_HYPOTHESES === "1" || env.PIX_BENCH_SEED_HYPOTHESES === "true",
    beamSchedule,
    coordinatePasses: parsePositiveInt(
      env.PIX_BENCH_COORDINATE_PASSES,
      "PIX_BENCH_COORDINATE_PASSES",
      DEFAULT_ROUTER_SEARCH_STRATEGY_PARAMETERS.coordinatePasses,
    ),
    globalScouts: parsePositiveInt(
      env.PIX_BENCH_GLOBAL_SCOUTS,
      "PIX_BENCH_GLOBAL_SCOUTS",
      DEFAULT_ROUTER_SEARCH_STRATEGY_PARAMETERS.globalScouts,
    ),
  }
}
