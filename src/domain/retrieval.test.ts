import { expect, it } from "vitest"

import {
  PRODUCTION_COMPATIBILITY_CONFIG,
  PRODUCTION_PROFILES,
  decodeEvidenceRouterConfig,
  resolveProductionProfile,
} from "./retrieval.js"

it("defines the versioned RRF compatibility configuration", () => {
  expect(PRODUCTION_COMPATIBILITY_CONFIG).toMatchObject({
    schemaVersion: 1,
    fusion: "rrf",
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

it("resolves explicit production profiles with compatibility as the default", () => {
  expect(resolveProductionProfile().name).toBe("compatibility")
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
