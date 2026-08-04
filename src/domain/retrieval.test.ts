import { expect, it } from "vitest"

import {
  PRODUCTION_COMPATIBILITY_CONFIG,
  PRODUCTION_PROFILES,
  PRODUCTION_RRF_BASELINE_CONFIG,
  PROMOTED_SEARCH_PRIORITY_CONFIG,
  decodeEvidenceRouterConfig,
  resolveProductionProfile,
} from "./retrieval.js"

it("defines the DBSF compatibility configuration and keeps an RRF baseline", () => {
  expect(PROMOTED_SEARCH_PRIORITY_CONFIG.fusion).toBe("dbsf")
  expect(PRODUCTION_COMPATIBILITY_CONFIG).toBe(PROMOTED_SEARCH_PRIORITY_CONFIG)
  expect(PRODUCTION_COMPATIBILITY_CONFIG).toMatchObject({ fusion: "dbsf" })
  expect(PRODUCTION_RRF_BASELINE_CONFIG).toMatchObject({ fusion: "rrf" })
  expect("schemaVersion" in PRODUCTION_COMPATIBILITY_CONFIG).toBe(false)
})

it("uses the promoted search-priority router candidate in production", () => {
  expect(PRODUCTION_COMPATIBILITY_CONFIG).toMatchObject({
    candidateDepth: 200,
    baseWeights: { identity: 0.6, camelcase: 0.5, bm25: 0.9, dense: 1, sparse: 0.1 },
    scoreInfluence: { identity: 0, camelcase: 0.5, bm25: 0.8, dense: 0.6, sparse: 0 },
    geometryInfluence: { identity: 0, camelcase: 0.6, bm25: 0.1, dense: 0, sparse: 0 },
    termCoverageInfluence: { identity: 0, camelcase: 0.1, bm25: 0.2, dense: 0, sparse: 0 },
    pairwiseAgreementInfluence: {
      identity: 0,
      camelcase: 0.9,
      bm25: 0.8,
      dense: 0.8,
      sparse: 0.7,
    },
    denseConfidenceInfluence: { identity: 0, camelcase: 0, bm25: 0, dense: 0.6, sparse: 0 },
    identifierInfluence: { identity: 0, camelcase: 0.4, bm25: -0.1, dense: -0.1, sparse: -0.7 },
    queryLengthInfluence: { identity: 0, camelcase: -0.3, bm25: -0.4, dense: -0.3, sparse: -0.4 },
  })
  expect(PRODUCTION_PROFILES.balanced.config.scoreInfluence).toEqual(
    PRODUCTION_COMPATIBILITY_CONFIG.scoreInfluence,
  )
})

it("rejects malformed production configurations", () => {
  expect(() =>
    decodeEvidenceRouterConfig({
      ...PRODUCTION_COMPATIBILITY_CONFIG,
      fusion: "unknown",
    }),
  ).toThrow()
})

it("resolves explicit production profiles with compatibility as the default", () => {
  expect(resolveProductionProfile().name).toBe("compatibility")
  expect(Object.values(PRODUCTION_PROFILES).every(({ config }) => config.fusion === "dbsf")).toBe(
    true,
  )
  for (const profile of Object.values(PRODUCTION_PROFILES)) {
    expect(profile.config.fusion).toBe(PROMOTED_SEARCH_PRIORITY_CONFIG.fusion)
    expect(profile.config.scoreInfluence).toEqual(PRODUCTION_COMPATIBILITY_CONFIG.scoreInfluence)
    expect(profile.config.pairwiseAgreementInfluence).toEqual(
      PRODUCTION_COMPATIBILITY_CONFIG.pairwiseAgreementInfluence,
    )
  }
  expect(resolveProductionProfile("balanced").config.baseWeights).toEqual({
    identity: 1,
    camelcase: 1,
    bm25: 1,
    dense: 1,
    sparse: 1,
  })
  expect(PRODUCTION_PROFILES["code-navigation"].experimental).toBe(true)
  expect(PRODUCTION_PROFILES["natural-language"].experimental).toBe(true)
})
