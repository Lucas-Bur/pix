import { expect, it } from "vitest"

import {
  PRODUCTION_COMPATIBILITY_CONFIG,
  type ChannelCoefficients,
  type ChannelRankings,
  type EvidenceRouterConfig,
} from "../../domain/retrieval.js"
import { buildRoutingEvidence, routeWithEvidence } from "./evidence-router.js"

const zeroCoefficients: ChannelCoefficients = {
  identity: 0,
  camelcase: 0,
  bm25: 0,
  dense: 0,
  sparse: 0,
}

const emptyRankings: ChannelRankings = {
  identity: [],
  camelcase: [],
  bm25: [],
  dense: [],
  sparse: [],
}

it("reports channel availability and observable query evidence", () => {
  const evidence = buildRoutingEvidence("find the target", {
    ...emptyRankings,
    dense: [
      { chunkIndex: 0, score: 1 },
      { chunkIndex: 1, score: 0.1 },
    ],
  })

  expect(evidence.tokenCount).toBe(3)
  expect(evidence.channels.dense.available).toBe(true)
  expect(evidence.channels.identity.available).toBe(false)
  expect(evidence.denseConfidence.confidence).toBeGreaterThan(0)
})

it("does not route unavailable channels and applies bounded influences", () => {
  const config: EvidenceRouterConfig = {
    ...PRODUCTION_COMPATIBILITY_CONFIG,
    baseWeights: { ...PRODUCTION_COMPATIBILITY_CONFIG.baseWeights, dense: 1 },
    scoreInfluence: { ...zeroCoefficients, dense: 1 },
    geometryInfluence: zeroCoefficients,
    termCoverageInfluence: zeroCoefficients,
    pairwiseAgreementInfluence: zeroCoefficients,
    denseConfidenceInfluence: zeroCoefficients,
    identifierInfluence: zeroCoefficients,
    queryLengthInfluence: zeroCoefficients,
  }
  const weights = routeWithEvidence(
    buildRoutingEvidence("find target", {
      ...emptyRankings,
      dense: [
        { chunkIndex: 0, score: 1 },
        { chunkIndex: 1, score: 0.1 },
      ],
    }),
    config,
  )

  expect(weights.identity).toBe(0)
  expect(weights.dense).toBeGreaterThan(0)
  expect(Object.values(weights).every((weight) => Number.isFinite(weight) && weight >= 0)).toBe(
    true,
  )
})
