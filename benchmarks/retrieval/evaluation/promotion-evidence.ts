import type { EvidenceRouterConfig } from "../../../src/domain/retrieval.js"
import type {
  CandidateStability,
  EvidenceRouterSearchResult,
  GuardrailBlocker,
  HoldoutUncertainty,
  PromotionEvidence,
  QualityMetric,
  QualitySummary,
  RouterObjective,
  ValidationStrategy,
} from "./types.js"

const BOOTSTRAP_SAMPLES = 1_000
/** Maximum objective-metric delta between two configs that still counts as one plateau. */
export const STABILITY_EPSILON = 0.005
const QUALITY_METRICS: readonly QualityMetric[] = [
  "ndcgAt5",
  "ndcgAt10",
  "ndcgAt20",
  "ndcgAt50",
  "recallAt5",
  "recallAt10",
  "recallAt20",
  "recallAt50",
  "contextRecallAt4096",
  "meanReciprocalRank",
]

/** Excluded-fold fields needed to derive promotion evidence. */
export type PromotionHoldoutRow = Pick<
  EvidenceRouterSearchResult,
  | "model"
  | "fusion"
  | "objective"
  | "strategy"
  | "fold"
  | "validation"
  | "productionValidation"
  | "config"
  | "holdoutBreakdown"
>

const precise = (value: number): number => Number(value.toFixed(12))

/** Describe every metric that falls below its baseline after applying the configured tolerance. */
export const buildGuardrailBlockers = (
  partition: GuardrailBlocker["partition"],
  name: string,
  candidate: QualitySummary,
  baseline: QualitySummary,
  metrics: readonly QualityMetric[],
  tolerance: number,
): readonly GuardrailBlocker[] =>
  metrics.flatMap((metric) => {
    const delta = precise(candidate[metric] - baseline[metric])
    return delta < -tolerance
      ? [
          {
            partition,
            name,
            metric,
            candidateValue: candidate[metric],
            baselineValue: baseline[metric],
            tolerance,
            delta,
          },
        ]
      : []
  })

const percentile = (values: readonly number[], fraction: number): number => {
  if (values.length === 0) return 0
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.min(sorted.length - 1, Math.floor(fraction * sorted.length))] ?? 0
}

const bootstrapInterval = (
  deltas: readonly number[],
): Pick<HoldoutUncertainty, "meanDelta" | "lowerBound" | "upperBound" | "bootstrapSamples"> => {
  if (deltas.length === 0)
    return { meanDelta: 0, lowerBound: 0, upperBound: 0, bootstrapSamples: 0 }
  let state = 1
  const means = Array.from({ length: BOOTSTRAP_SAMPLES }, () => {
    let total = 0
    for (let index = 0; index < deltas.length; index++) {
      state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0
      total += deltas[state % deltas.length] ?? 0
    }
    return total / deltas.length
  })
  return {
    meanDelta: precise(deltas.reduce((sum, delta) => sum + delta, 0) / deltas.length),
    lowerBound: precise(percentile(means, 0.025)),
    upperBound: precise(percentile(means, 0.975)),
    bootstrapSamples: BOOTSTRAP_SAMPLES,
  }
}

const buildUncertainty = (rows: readonly PromotionHoldoutRow[]): readonly HoldoutUncertainty[] => {
  const observations = new Map<
    string,
    {
      strategy: ValidationStrategy
      partition: GuardrailBlocker["partition"]
      name: string
      metric: QualityMetric
      deltas: number[]
    }
  >()
  for (const row of rows)
    for (const holdout of row.holdoutBreakdown)
      for (const metric of QUALITY_METRICS) {
        const key = `${row.strategy}\0${holdout.dimension}\0${holdout.name}\0${metric}`
        const observation = observations.get(key) ?? {
          strategy: row.strategy,
          partition: holdout.dimension,
          name: holdout.name,
          metric,
          deltas: [],
        }
        observation.deltas.push(holdout.candidate[metric] - holdout.baseline[metric])
        observations.set(key, observation)
      }
  return [...observations.values()].map(({ deltas, ...observation }) => ({
    ...observation,
    ...bootstrapInterval(deltas),
  }))
}

const objectiveMetric = (objective: RouterObjective): QualityMetric => {
  if (objective === "direct") return "ndcgAt5"
  if (objective === "direct-recall-first") return "recallAt5"
  return objective === "reranker-top20" ? "recallAt20" : "recallAt50"
}

const configValues = (config: EvidenceRouterConfig): readonly number[] => [
  ...Object.values(config.baseWeights),
  ...Object.values(config.scoreInfluence),
  ...Object.values(config.geometryInfluence),
  ...Object.values(config.termCoverageInfluence),
  ...Object.values(config.pairwiseAgreementInfluence),
  ...Object.values(config.denseConfidenceInfluence),
  ...Object.values(config.identifierInfluence),
  ...Object.values(config.queryLengthInfluence),
]

/** Number of coordinates two configs differ in and the widest single-coordinate gap. */
const differingCoordinates = (
  left: EvidenceRouterConfig,
  right: EvidenceRouterConfig,
): { readonly count: number; readonly width: number } => {
  const leftValues = configValues(left)
  const rightValues = configValues(right)
  let count = 0
  let width = 0
  for (let index = 0; index < leftValues.length; index++) {
    const difference = Math.abs((leftValues[index] ?? 0) - (rightValues[index] ?? 0))
    if (difference > 0) {
      count++
      width = Math.max(width, difference)
    }
  }
  return { count, width }
}

const selectionFrequency = (
  rows: readonly PromotionHoldoutRow[],
): Pick<CandidateStability, "distinctSelections" | "selectionFrequency"> => {
  const frequencies = new Map<string, number>()
  for (const row of rows) {
    const key = JSON.stringify(row.config)
    frequencies.set(key, (frequencies.get(key) ?? 0) + 1)
  }
  return {
    distinctSelections: frequencies.size,
    selectionFrequency: rows.length === 0 ? 0 : Math.max(0, ...frequencies.values()) / rows.length,
  }
}

const localPerturbations = (
  rows: readonly PromotionHoldoutRow[],
): Pick<CandidateStability, "localPerturbations" | "plateauWidth" | "epsilonNeighborFraction"> => {
  const neighbors: Array<{ readonly qualityDifference: number; readonly width: number }> = []
  for (let leftIndex = 0; leftIndex < rows.length; leftIndex++)
    for (let rightIndex = leftIndex + 1; rightIndex < rows.length; rightIndex++) {
      const left = rows[leftIndex]
      const right = rows[rightIndex]
      if (left === undefined || right === undefined) continue
      const distance = differingCoordinates(left.config, right.config)
      if (distance.count !== 1) continue
      const metric = objectiveMetric(left.objective)
      neighbors.push({
        qualityDifference: Math.abs(left.validation[metric] - right.validation[metric]),
        width: distance.width,
      })
    }
  const epsilonNeighbors = neighbors.filter(
    ({ qualityDifference }) => qualityDifference <= STABILITY_EPSILON,
  )
  return {
    localPerturbations: neighbors.length,
    plateauWidth: precise(Math.max(0, ...epsilonNeighbors.map(({ width }) => width))),
    epsilonNeighborFraction:
      neighbors.length === 0 ? 0 : epsilonNeighbors.length / neighbors.length,
  }
}

const buildStability = (rows: readonly PromotionHoldoutRow[]): CandidateStability => {
  const metric = rows[0] === undefined ? "recallAt20" : objectiveMetric(rows[0].objective)
  const holdoutDrops = rows.map((row) => row.productionValidation[metric] - row.validation[metric])
  return {
    folds: rows.length,
    ...selectionFrequency(rows),
    ...localPerturbations(rows),
    medianHoldoutDrop: precise(percentile(holdoutDrops, 0.5)),
    worstCaseHoldoutDrop: precise(Math.max(0, ...holdoutDrops)),
    seeds: 1,
    restarts: 1,
  }
}

const promotionKey = (row: PromotionHoldoutRow): string =>
  `${row.model}\0${row.fusion}\0${row.objective}`

/** Derive promotion decisions exclusively from excluded-fold results, never fit-all quality. */
export const derivePromotionEvidence = (
  rows: readonly PromotionHoldoutRow[],
  expectedStrategies: readonly ValidationStrategy[],
  finalTest: { readonly strategy: ValidationStrategy; readonly fold: string },
): readonly PromotionEvidence[] => {
  const groups = new Map<string, PromotionHoldoutRow[]>()
  for (const row of rows)
    groups.set(promotionKey(row), [...(groups.get(promotionKey(row)) ?? []), row])
  return [...groups.values()].map((group) => {
    const first = group[0]
    if (first === undefined) throw new Error("Promotion evidence group cannot be empty")
    const strategies = new Set(group.map((row) => row.strategy))
    const missingStrategies = expectedStrategies.filter((strategy) => !strategies.has(strategy))
    const finalTestRow = group.find(
      (row) => row.strategy === finalTest.strategy && row.fold === finalTest.fold,
    )
    const finalTestGuardrailsMet =
      finalTestRow?.holdoutBreakdown.every((holdout) => holdout.guardrailsMet) ?? false
    const blockers = group.flatMap((row) =>
      row.holdoutBreakdown.flatMap((holdout) =>
        holdout.blockers.map((blocker) => ({ ...blocker, strategy: row.strategy, fold: row.fold })),
      ),
    )
    return {
      model: first.model,
      fusion: first.fusion,
      objective: first.objective,
      promotionStatus:
        missingStrategies.length === 0 && finalTestGuardrailsMet && blockers.length === 0
          ? "eligible"
          : "no-eligible-candidate",
      missingStrategies,
      finalTest: {
        ...finalTest,
        present: finalTestRow !== undefined,
        guardrailsMet: finalTestGuardrailsMet,
      },
      blockers,
      uncertainty: buildUncertainty(group),
      stability: buildStability(group),
    }
  })
}
