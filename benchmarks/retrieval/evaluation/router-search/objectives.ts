import { SEARCH_PRIORITY_PROFILE, type OptimizationProfile } from "../optimization-profiles.js"
import {
  ROUTER_OBJECTIVES,
  type QualityMetric,
  type QualitySummary,
  type RouterObjective,
} from "../types.js"

export const OBJECTIVE_PRIORITIES: Readonly<Record<RouterObjective, readonly QualityMetric[]>> = {
  direct: [
    "ndcgAt5",
    "ndcgAt10",
    "ndcgAt20",
    "recallAt5",
    "recallAt10",
    "contextRecallAt4096",
    "recallAt20",
    "recallAt50",
    "meanReciprocalRank",
  ],
  "direct-recall-first": [
    "recallAt5",
    "recallAt10",
    "contextRecallAt4096",
    "recallAt20",
    "recallAt50",
    "meanReciprocalRank",
    "ndcgAt5",
    "ndcgAt10",
    "ndcgAt20",
  ],
  "reranker-top20": [
    "recallAt20",
    "recallAt10",
    "recallAt5",
    "contextRecallAt4096",
    "recallAt50",
    "meanReciprocalRank",
  ],
  "reranker-top50": [
    "recallAt50",
    "recallAt20",
    "recallAt10",
    "recallAt5",
    "contextRecallAt4096",
    "meanReciprocalRank",
  ],
}

export const OBJECTIVE_GUARDRAILS: Readonly<Record<RouterObjective, readonly QualityMetric[]>> = {
  direct: ["recallAt20", "recallAt50", "contextRecallAt4096"],
  "direct-recall-first": ["recallAt20", "recallAt50", "contextRecallAt4096"],
  "reranker-top20": ["recallAt5", "recallAt10", "recallAt20", "recallAt50", "contextRecallAt4096"],
  "reranker-top50": ["recallAt5", "recallAt10", "recallAt20", "recallAt50", "contextRecallAt4096"],
}

// The recall-first direct objective is an ablation over the same searched archive, not another
// source of beam candidates. This preserves the pre-ablation budget of two candidates per scenario.
export const SEARCH_OBJECTIVES = ROUTER_OBJECTIVES.filter(
  (objective): objective is Exclude<RouterObjective, "direct-recall-first"> =>
    objective !== "direct-recall-first",
)

export const isWithinGuardrails = (
  quality: QualitySummary,
  baseline: QualitySummary | undefined,
  profile: OptimizationProfile = SEARCH_PRIORITY_PROFILE,
  objective?: RouterObjective,
): boolean =>
  baseline === undefined ||
  (objective === undefined
    ? profile.metricObjective.guardrailMetrics
    : OBJECTIVE_GUARDRAILS[objective]
  ).every(
    (metric) => quality[metric] >= baseline[metric] - profile.metricObjective.guardrailTolerance,
  )

export const unweightedProfile = (profile: OptimizationProfile): OptimizationProfile => ({
  ...profile,
  queryFormWeights: { identifier: 1, agentTask: 1, naturalQuestion: 1, searchPhrase: 1 },
})

export const compareObjectiveQuality = (
  left: QualitySummary,
  right: QualitySummary,
  objective: RouterObjective,
  baseline?: QualitySummary,
  profile: OptimizationProfile = SEARCH_PRIORITY_PROFILE,
): number => {
  const leftGuardrails = isWithinGuardrails(left, baseline, profile, objective)
  const rightGuardrails = isWithinGuardrails(right, baseline, profile, objective)
  if (leftGuardrails !== rightGuardrails) return leftGuardrails ? -1 : 1
  const priorities =
    profile.metricObjective.name === objective
      ? profile.metricObjective.priority
      : OBJECTIVE_PRIORITIES[objective]
  for (const metric of priorities) {
    if (left[metric] > right[metric]) return -1
    if (left[metric] < right[metric]) return 1
  }
  return 0
}

export const compareSuccessiveHalvingQuality = (
  left: QualitySummary,
  right: QualitySummary,
): number => {
  const leftValues = [
    left.recallAt20,
    left.recallAt10,
    left.contextRecallAt4096,
    left.meanReciprocalRank,
  ]
  const rightValues = [
    right.recallAt20,
    right.recallAt10,
    right.contextRecallAt4096,
    right.meanReciprocalRank,
  ]
  for (let index = 0; index < leftValues.length; index++) {
    if (leftValues[index] > rightValues[index]) return -1
    if (leftValues[index] < rightValues[index]) return 1
  }
  return 0
}
