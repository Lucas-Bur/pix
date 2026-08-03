import { expect, it } from "vitest"

import {
  OPTIMIZATION_PROFILES,
  SEARCH_PRIORITY_PROFILE,
  decodeOptimizationProfile,
} from "../retrieval/optimization-profiles.js"

it("records the weighted search-priority objective without a profile schema version", () => {
  expect(SEARCH_PRIORITY_PROFILE.queryFormWeights).toEqual({
    identifier: 1,
    agentTask: 2,
    naturalQuestion: 3,
    searchPhrase: 4,
  })
  expect("schemaVersion" in SEARCH_PRIORITY_PROFILE).toBe(false)
  expect(OPTIMIZATION_PROFILES["code-navigation"].queryFormWeights.identifier).toBeGreaterThan(
    OPTIMIZATION_PROFILES["code-navigation"].queryFormWeights.naturalQuestion,
  )
  expect(
    OPTIMIZATION_PROFILES["code-navigation"].fusionConfig.baseWeights.identity,
  ).toBeGreaterThan(OPTIMIZATION_PROFILES["natural-language"].fusionConfig.baseWeights.identity)
})

it("rejects semantically empty benchmark profiles", () => {
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
