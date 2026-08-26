import { expect, it } from "vitest"

import {
  SEARCH_PRIORITY_PROFILE,
  type OptimizationProfile,
} from "../retrieval/evaluation/optimization-profiles.js"
import {
  emptyRouterConfig,
  routerKey,
  withInfluence,
} from "../retrieval/evaluation/router-search/config-space.js"
import {
  primaryObjectiveMetric,
  reorderWithStabilityTieBreak,
  scoreArchiveStability,
} from "../retrieval/evaluation/router-search/stability.js"
import type { QualitySummary, SelectionStability } from "../retrieval/evaluation/types.js"

const quality = (recallAt20: number): QualitySummary => ({
  recallAt5: 0,
  recallAt10: 0,
  recallAt20,
  recallAt50: 0,
  ndcgAt5: 0,
  ndcgAt10: 0,
  ndcgAt20: 0,
  ndcgAt50: 0,
  contextRecallAt4096: 0,
  meanReciprocalRank: 0,
})

it("pairs each candidate with its single-coordinate neighbour statistics", () => {
  const plain = emptyRouterConfig({ identity: 1, camelcase: 0.5, bm25: 1, dense: 0.5, sparse: 1 })
  const nudged = withInfluence(plain, "scoreInfluence", "bm25", 0.5)
  const farAway = withInfluence(nudged, "geometryInfluence", "identity", 0.3)
  const scored = scoreArchiveStability(
    [
      { config: plain, quality: quality(0.6) },
      { config: nudged, quality: quality(0.599) },
      { config: farAway, quality: quality(0.9) },
    ],
    "recallAt20",
  )

  expect(scored.map(({ candidate }) => routerKey(candidate.config))).toEqual([
    routerKey(plain),
    routerKey(nudged),
    routerKey(farAway),
  ])
  expect(scored[0]?.stability).toEqual({
    metric: "recallAt20",
    neighbors: 1,
    epsilonNeighborFraction: 1,
    plateauWidth: 0.5,
  })
  expect(scored[2]?.stability).toEqual({
    metric: "recallAt20",
    neighbors: 1,
    epsilonNeighborFraction: 0,
    plateauWidth: 0,
  })
})

it("reorders only the within-noise head towards higher stability", () => {
  const ranked: readonly { key: string; value: number; stability: SelectionStability }[] = [
    {
      key: "flat-leader",
      value: 0.6,
      stability: {
        metric: "recallAt20",
        neighbors: 4,
        epsilonNeighborFraction: 0,
        plateauWidth: 0,
      },
    },
    {
      key: "plateau-runner",
      value: 0.598,
      stability: {
        metric: "recallAt20",
        neighbors: 4,
        epsilonNeighborFraction: 0.75,
        plateauWidth: 0.5,
      },
    },
    {
      key: "outside-noise",
      value: 0.4,
      stability: {
        metric: "recallAt20",
        neighbors: 4,
        epsilonNeighborFraction: 0,
        plateauWidth: 0,
      },
    },
  ]
  const ordered = reorderWithStabilityTieBreak(ranked, 0.01, ({ value }) => value)
  expect(ordered.map(({ key }) => key)).toEqual(["plateau-runner", "flat-leader", "outside-noise"])
})

it("keeps the ranking untouched without a noise window", () => {
  const ranked: readonly { key: string; value: number; stability: SelectionStability }[] = [
    {
      key: "a",
      value: 0.6,
      stability: {
        metric: "recallAt20",
        neighbors: 0,
        epsilonNeighborFraction: 0,
        plateauWidth: 0,
      },
    },
    {
      key: "b",
      value: 0.598,
      stability: {
        metric: "recallAt20",
        neighbors: 0,
        epsilonNeighborFraction: 1,
        plateauWidth: 1,
      },
    },
  ]
  expect(reorderWithStabilityTieBreak(ranked.slice(0, 1), 0.01, ({ value }) => value)).toHaveLength(
    1,
  )
})

it("resolves the primary objective metric through the active profile", () => {
  expect(primaryObjectiveMetric("reranker-top20")).toBe("recallAt20")
  const directProfile: OptimizationProfile = {
    ...SEARCH_PRIORITY_PROFILE,
    metricObjective: { ...SEARCH_PRIORITY_PROFILE.metricObjective, name: "direct" },
  }
  expect(primaryObjectiveMetric("direct", directProfile)).toBe(
    directProfile.metricObjective.priority[0],
  )
})
