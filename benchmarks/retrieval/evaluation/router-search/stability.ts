import type { EvidenceRouterParameters as EvidenceRouterConfig } from "../../../../src/domain/retrieval.js"
import { SEARCH_PRIORITY_PROFILE, type OptimizationProfile } from "../optimization-profiles.js"
import { STABILITY_EPSILON } from "../promotion-evidence.js"
import type { QualityMetric, RouterObjective, SelectionStability } from "../types.js"
import type { RouterCandidate } from "./config-space.js"
import { OBJECTIVE_PRIORITIES } from "./objectives.js"

/** Flattened coordinate vector of one search-parameter config. */
const parameterCoordinateValues = (config: EvidenceRouterConfig): readonly number[] => [
  ...Object.values(config.baseWeights),
  ...Object.values(config.scoreInfluence),
  ...Object.values(config.geometryInfluence),
  ...Object.values(config.termCoverageInfluence),
  ...Object.values(config.pairwiseAgreementInfluence),
  ...Object.values(config.denseConfidenceInfluence),
  ...Object.values(config.identifierInfluence),
  ...Object.values(config.queryLengthInfluence),
]

/** Objective metric whose ordering defines "within measurement noise" for one objective. */
export const primaryObjectiveMetric = (
  objective: RouterObjective,
  profile: OptimizationProfile = SEARCH_PRIORITY_PROFILE,
): QualityMetric =>
  profile.metricObjective.name === objective
    ? profile.metricObjective.priority[0]!
    : OBJECTIVE_PRIORITIES[objective][0]!

/**
 * Pair each archive candidate with its local-stability measurement under one objective metric:
 * among single-coordinate neighbours, the share whose metric delta stays within
 * `STABILITY_EPSILON`, plus the widest level jump among those plateau neighbours. Value vectors are
 * precomputed so the pairwise scan stays allocation-free.
 */
export const scoreArchiveStability = (
  candidates: readonly RouterCandidate[],
  metric: QualityMetric,
): ReadonlyArray<{
  readonly candidate: RouterCandidate
  readonly stability: SelectionStability
}> => {
  const vectors = candidates.map((candidate) => ({
    config: candidate,
    values: parameterCoordinateValues(candidate.config),
    quality: candidate.quality[metric],
  }))
  return vectors.map((candidate, index) => {
    let neighbors = 0
    let epsilonNeighbors = 0
    let plateauWidth = 0
    for (let otherIndex = 0; otherIndex < vectors.length; otherIndex++) {
      if (otherIndex === index) continue
      const other = vectors[otherIndex]!
      let differing = 0
      let width = 0
      for (let coordinate = 0; coordinate < candidate.values.length; coordinate++) {
        const difference = Math.abs(candidate.values[coordinate]! - other.values[coordinate]!)
        if (difference > 0) {
          differing++
          width = Math.max(width, difference)
        }
      }
      if (differing !== 1) continue
      neighbors++
      if (Math.abs(candidate.quality - other.quality) <= STABILITY_EPSILON) {
        epsilonNeighbors++
        plateauWidth = Math.max(plateauWidth, width)
      }
    }
    return {
      candidate: candidate.config,
      stability: {
        metric,
        neighbors,
        epsilonNeighborFraction: neighbors === 0 ? 0 : epsilonNeighbors / neighbors,
        plateauWidth,
      },
    }
  })
}

const compareStabilityDescending = (left: SelectionStability, right: SelectionStability): number =>
  right.epsilonNeighborFraction - left.epsilonNeighborFraction ||
  right.plateauWidth - left.plateauWidth

/**
 * Reorder ranked entries so that within the leader's measurement-noise window on the objective
 * metric, locally stabler entries lead (highest epsilon-neighbour fraction, then widest plateau).
 * Entries outside the window keep their original order.
 */
export const reorderWithStabilityTieBreak = <T extends { readonly stability: SelectionStability }>(
  ranked: readonly T[],
  noiseTolerance: number,
  objectiveValue: (entry: T) => number,
): readonly T[] => {
  const best = ranked[0]
  if (best === undefined) return []
  const bestValue = objectiveValue(best)
  let split = 1
  while (split < ranked.length && objectiveValue(ranked[split]!) >= bestValue - noiseTolerance)
    split++
  if (split <= 1) return ranked
  return [
    ...ranked
      .slice(0, split)
      .map((entry, rank) => ({ entry, rank }))
      .sort(
        (left, right) =>
          compareStabilityDescending(left.entry.stability, right.entry.stability) ||
          left.rank - right.rank,
      )
      .map(({ entry }) => entry),
    ...ranked.slice(split),
  ]
}
