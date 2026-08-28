import { resolveScoutSequence, type ScoutSequenceName } from "./evaluation/scouts/index.js"

/** Benchmark-only search knobs resolved once per run from the environment. */
export interface SearchKnobs {
  readonly scoutSequence: ScoutSequenceName
  readonly seedHypotheses: boolean
  readonly globalScouts: number
  readonly localCloudPoints: number
  readonly localCloudRadiusLevels: number
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
  const localCloudPoints = parsePositiveInt(
    env.PIX_BENCH_LOCAL_CLOUD_POINTS,
    "PIX_BENCH_LOCAL_CLOUD_POINTS",
    16,
  )
  const localCloudRadiusLevels = parsePositiveInt(
    env.PIX_BENCH_LOCAL_CLOUD_RADIUS,
    "PIX_BENCH_LOCAL_CLOUD_RADIUS",
    2,
  )
  if (localCloudPoints > 0 && localCloudRadiusLevels === 0) {
    throw new Error(
      "PIX_BENCH_LOCAL_CLOUD_RADIUS must be >= 1 when PIX_BENCH_LOCAL_CLOUD_POINTS > 0",
    )
  }
  return {
    scoutSequence: resolveScoutSequence(env.PIX_BENCH_SCOUT_SEQUENCE),
    seedHypotheses:
      env.PIX_BENCH_SEED_HYPOTHESES === undefined
        ? true
        : env.PIX_BENCH_SEED_HYPOTHESES === "1" || env.PIX_BENCH_SEED_HYPOTHESES === "true",
    globalScouts: parsePositiveInt(env.PIX_BENCH_GLOBAL_SCOUTS, "PIX_BENCH_GLOBAL_SCOUTS", 512),
    localCloudPoints,
    localCloudRadiusLevels,
  }
}
