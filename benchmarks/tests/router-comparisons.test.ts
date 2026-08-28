import { describe, expect, it } from "@effect/vitest"

import { ZERO_CHANNEL_COEFFICIENTS, type ChannelRankings } from "../../src/domain/retrieval.js"
import { buildRoutingEvidence } from "../../src/lib/retrieval/evidence-router.js"
import {
  classifyRouterDimensions,
  compareRouterModelsAndMethods,
  evaluateRouterComparisonHoldout,
  routeWithComparisonModel,
  searchRouterComparison,
  selectComplexityAwareCandidate,
  selectOneStandardErrorCandidate,
  type RouterComparisonCandidate,
  type RouterFittingMethod,
} from "../retrieval/evaluation/router-search/comparisons.js"
import {
  emptyRouterConfig,
  routerParameters,
} from "../retrieval/evaluation/router-search/config-space.js"

const rankings: ChannelRankings = {
  identity: [],
  camelcase: [],
  bm25: [
    { chunkIndex: 0, score: 10 },
    { chunkIndex: 1, score: 1 },
  ],
  dense: [
    { chunkIndex: 0, score: 0.7 },
    { chunkIndex: 2, score: 0.5 },
  ],
  sparse: [],
}
const evidence = [
  buildRoutingEvidence("target", rankings),
  buildRoutingEvidence(
    "find where the project configuration implementation loads all user settings",
    rankings,
  ),
]
const seed = emptyRouterConfig({ identity: 0, camelcase: 0, bm25: 1, dense: 1, sparse: 0 })

describe("router comparisons", () => {
  it("routes with bounded multiplicative and log-linear benchmark models", () => {
    const config = {
      ...seed,
      queryLengthInfluence: { ...ZERO_CHANNEL_COEFFICIENTS, dense: 1 },
    }
    const multiplicative = routeWithComparisonModel("multiplicative", evidence[1]!, config)
    const logLinear = routeWithComparisonModel("regularized-log-linear", evidence[1]!, config)

    expect(logLinear.dense).toBeGreaterThan(0)
    expect(logLinear.dense).not.toBe(multiplicative.dense)
    expect(logLinear.identity).toBe(0)
  })

  it("records active, inactive, and data-constant dimensions", () => {
    const selectedParameters = routerParameters().filter((parameter) =>
      [
        "baseWeights.bm25",
        "scoreInfluence.identity",
        "scoreInfluence.bm25",
        "queryLengthInfluence.bm25",
      ].includes(parameter.name),
    )
    const diagnostics = classifyRouterDimensions(selectedParameters, evidence)

    expect(diagnostics.find((entry) => entry.name === "scoreInfluence.identity")?.status).toBe(
      "inactive",
    )
    expect(diagnostics.find((entry) => entry.name === "scoreInfluence.bm25")?.status).toBe(
      "data-constant",
    )
    expect(diagnostics.find((entry) => entry.name === "queryLengthInfluence.bm25")?.status).toBe(
      "active",
    )
  })

  it("compares all derivative-free fitting methods with development-only scores", async () => {
    const parameters = routerParameters().filter((parameter) =>
      ["baseWeights.bm25", "queryLengthInfluence.bm25"].includes(parameter.name),
    )
    const methods: readonly RouterFittingMethod[] = [
      "staged",
      "alternating-block-coordinate",
      "deterministic-restarts",
      "local-search",
    ]

    for (const method of methods) {
      const result = await searchRouterComparison({
        model: "regularized-log-linear",
        method,
        seed,
        parameters,
        evidence,
        pruneInactive: true,
        evaluateDevelopment: async (configs) =>
          configs.map((config) => ({
            mean: config.baseWeights.bm25 + config.queryLengthInfluence.bm25,
            standardError: 0.01,
          })),
      })
      expect(result.selected.score.mean).toBeGreaterThan(0)
      expect(result.optimalityClaim).toBe("derivative-free-heuristic-no-global-optimality-claim")
      const holdout = await evaluateRouterComparisonHoldout(result, async (configs) =>
        configs.map(() => ({ mean: 0.5, standardError: 0.1 })),
      )
      expect(holdout.selected.mean).toBe(0.5)
    }
  })

  it("supports complexity utility and one-standard-error simplicity selection", () => {
    const simple: RouterComparisonCandidate = {
      config: seed,
      score: { mean: 0.79, standardError: 0.01 },
    }
    const complex: RouterComparisonCandidate = {
      config: {
        ...seed,
        scoreInfluence: { ...ZERO_CHANNEL_COEFFICIENTS, bm25: 1 },
      },
      score: { mean: 0.8, standardError: 0.02 },
    }

    expect(selectComplexityAwareCandidate([complex, simple], 0.02)).toBe(simple)
    expect(selectOneStandardErrorCandidate([complex, simple])).toBe(simple)
  })

  it("runs the complete product and log-linear comparison grid", async () => {
    const parameters = routerParameters().filter(
      (parameter) => parameter.name === "queryLengthInfluence.bm25",
    )
    const results = await compareRouterModelsAndMethods({
      seed,
      parameters,
      evidence,
      evaluateDevelopment: async (model, configs) =>
        configs.map((config) => ({
          mean: config.queryLengthInfluence.bm25 + (model === "multiplicative" ? 0 : 0.01),
          standardError: 0.01,
        })),
    })

    expect(results).toHaveLength(8)
    expect(new Set(results.map((result) => result.model))).toEqual(
      new Set(["multiplicative", "regularized-log-linear"]),
    )
  })
})
