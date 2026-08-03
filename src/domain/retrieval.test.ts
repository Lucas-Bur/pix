import { expect, it } from "vitest"

import { PRODUCTION_COMPATIBILITY_CONFIG, decodeEvidenceRouterConfig } from "./retrieval.js"

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
