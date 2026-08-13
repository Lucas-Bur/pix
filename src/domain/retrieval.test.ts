import { expect, it } from "vitest"

import {
  PRODUCTION_COMPATIBILITY_CONFIG,
  PRODUCTION_PROFILES,
  PROMOTED_SEARCH_PRIORITY_CONFIG,
  decodeEvidenceRouterConfig,
  resolveProductionProfile,
} from "./retrieval.js"

it("defines the promoted DBSF compatibility configuration", () => {
  expect(PROMOTED_SEARCH_PRIORITY_CONFIG.fusion).toBe("dbsf")
  expect(PRODUCTION_COMPATIBILITY_CONFIG).toMatchObject({ fusion: "dbsf" })
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
})

it("rejects malformed production configurations", () => {
  expect(() =>
    decodeEvidenceRouterConfig({
      ...PRODUCTION_COMPATIBILITY_CONFIG,
      fusion: "unknown",
    }),
  ).toThrow()
})

it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
  "rejects non-finite router values: %s",
  (value) => {
    expect(() =>
      decodeEvidenceRouterConfig({
        ...PRODUCTION_COMPATIBILITY_CONFIG,
        baseWeights: { ...PRODUCTION_COMPATIBILITY_CONFIG.baseWeights, dense: value },
      }),
    ).toThrow()
  },
)

it("registers named runtime profiles while matrix-specific values are pending", () => {
  expect(Object.keys(PRODUCTION_PROFILES)).toEqual([
    "compatibility",
    "balanced",
    "code-navigation",
    "natural-language",
  ])
  expect(resolveProductionProfile().name).toBe("compatibility")
  expect(resolveProductionProfile("code-navigation").name).toBe("code-navigation")
  expect(
    Object.values(PRODUCTION_PROFILES).every(
      ({ config }) => config.fusion === "dbsf" && config.candidateDepth === 200,
    ),
  ).toBe(true)
  expect(PRODUCTION_PROFILES["code-navigation"].experimental).toBe(true)
})
