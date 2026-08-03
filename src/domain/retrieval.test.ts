import { expect, it } from "vitest"

import {
  OPTIMIZATION_PROFILES,
  PRODUCTION_COMPATIBILITY_CONFIG,
  SEARCH_PRIORITY_PROFILE,
  decodeEvidenceRouterConfig,
  decodeOptimizationProfile,
} from "./retrieval.js"

it("defines the versioned RRF compatibility configuration", () => {
  expect(PRODUCTION_COMPATIBILITY_CONFIG).toMatchObject({
    schemaVersion: 1,
    fusion: "rrf",
  })
})

it("records the weighted search-priority objective", () => {
  expect(SEARCH_PRIORITY_PROFILE.queryFormWeights).toEqual({
    identifier: 1,
    agentTask: 2,
    naturalQuestion: 3,
    searchPhrase: 4,
  })
  expect(OPTIMIZATION_PROFILES["code-navigation"].queryFormWeights.identifier).toBeGreaterThan(
    OPTIMIZATION_PROFILES["code-navigation"].queryFormWeights.naturalQuestion,
  )
  expect(
    OPTIMIZATION_PROFILES["code-navigation"].fusionConfig.baseWeights.identity,
  ).toBeGreaterThan(OPTIMIZATION_PROFILES["natural-language"].fusionConfig.baseWeights.identity)
})

it("rejects malformed or semantically empty configurations", () => {
  expect(() =>
    decodeEvidenceRouterConfig({
      ...PRODUCTION_COMPATIBILITY_CONFIG,
      fusion: "unknown",
    }),
  ).toThrow()

  expect(() =>
    decodeOptimizationProfile({
      ...SEARCH_PRIORITY_PROFILE,
      queryFormWeights: {
        identifier: 0,
        agentTask: 0,
        naturalQuestion: 0,
        searchPhrase: 0,
      },
    }),
  ).toThrow()
})
