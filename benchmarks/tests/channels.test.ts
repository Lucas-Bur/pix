import { describe, expect, it } from "@effect/vitest"

import type { Chunk } from "../../src/domain/chunk.js"
import { buildBm25Index } from "../../src/lib/retrieval/bm25.js"
import {
  buildQueryTermCoverage,
  buildRoutingEvidence,
  routeWithEvidence,
} from "../../src/lib/retrieval/evidence-router.js"
import { fuseRankings } from "../../src/lib/retrieval/fusion.js"
import { buildIdentifierIndex } from "../../src/lib/retrieval/identifier-index.js"
import { recallAt, resolveGoldTargets } from "../retrieval/metrics.js"
import type { PreparedCorpus } from "../retrieval/prepare.js"
import { fuseVariant, rankLexicalChannels, RETRIEVAL_VARIANTS } from "../retrieval/ranking.js"
import { ROUTER_OBJECTIVES } from "../retrieval/types.js"
import {
  optimizeEvidenceRouter,
  optimizeWeights,
  selectEligibleCandidate,
} from "../retrieval/weight-search.js"

const texts = [
  "export function loadProjectConfiguration() { return config }",
  "export function loadProjectCache() { return cache }",
  "quasar ledger retries failed payment transactions",
  "session authentication user identity verification",
]

const chunks: readonly Chunk[] = texts.map((text, index) => ({
  id: String(index),
  idx: index,
  file: `src/chunk-${index}.ts`,
  startLine: 1,
  endLine: 1,
  startOffset: 0,
  endOffset: text.length,
  text,
}))

const identifiers = [
  { name: "loadProjectConfiguration", kind: "function" as const, chunkIndex: 0 },
  { name: "loadProjectCache", kind: "function" as const, chunkIndex: 1 },
]

const corpus: PreparedCorpus = {
  chunks,
  bm25Index: buildBm25Index(chunks.map((chunk, index) => ({ index, text: chunk.text }))),
  identifierIndex: buildIdentifierIndex(identifiers),
  identifiersByChunk: new Map([
    [0, new Set(["loadprojectconfiguration"])],
    [1, new Set(["loadprojectcache"])],
    [2, new Set<string>()],
    [3, new Set<string>()],
  ]),
  preparationDurationMs: 0,
}

const zeroChannelCoefficients = { identity: 0, camelcase: 0, bm25: 0, dense: 0, sparse: 0 }

const makeEvidenceRouterSamples = () => {
  const ranked = (target: number, offset: number, separated: boolean) =>
    Array.from({ length: separated ? 20 : 30 }, (_, rank) => ({
      chunkIndex: rank === 19 && separated ? target : offset + rank,
      score: separated && rank === 0 ? 10 : 1,
    }))
  const evidenceChunks = Array.from({ length: 100 }, (_, index) => ({
    ...chunks[0],
    id: String(index),
    idx: index,
    file: `src/evidence-${index}.ts`,
  }))
  return [
    {
      repository: "fixture",
      intentId: "fixture-bm25",
      queryKind: "searchPhrase" as const,
      groupedFold: 0,
      query: "find lexical target",
      rankings: {
        identity: [],
        camelcase: [],
        bm25: ranked(90, 0, true),
        dense: ranked(90, 30, false),
        sparse: [],
      },
      targets: [new Set([90])],
      chunks: evidenceChunks,
    },
    {
      repository: "fixture",
      intentId: "fixture-dense",
      queryKind: "naturalQuestion" as const,
      groupedFold: 1,
      query: "find semantic target",
      rankings: {
        identity: [],
        camelcase: [],
        bm25: ranked(91, 0, false),
        dense: ranked(91, 30, true),
        sparse: [],
      },
      targets: [new Set([91])],
      chunks: evidenceChunks,
    },
  ]
}

const selectTop20Router = <T extends { readonly objective: string }>(results: readonly T[]): T => {
  const result = results.find((candidate) => candidate.objective === "reranker-top20")
  if (result === undefined) throw new Error("Missing reranker-top20 router objective")
  return result
}

describe("retrieval benchmark fixture", () => {
  it("covers the benchmark's five-channel retrieval variants", () => {
    expect(new Set(RETRIEVAL_VARIANTS).size).toBe(21)
  })

  it("isolates the exact identity channel without prefix false positives", () => {
    const channels = rankLexicalChannels("loadProjectConfiguration", corpus)
    expect(channels.identity.map((entry) => entry.chunkIndex)).toEqual([0])
    expect(channels.identity.some((entry) => entry.chunkIndex === 1)).toBe(false)
  })

  it("ranks the identifier matching both constituent words first", () => {
    const channels = rankLexicalChannels("project configuration", corpus)
    expect(channels.camelcase[0].chunkIndex).toBe(0)
    expect(channels.camelcase[0].score).toBe(2)
  })

  it("finds rare lexical terms through BM25", () => {
    const channels = rankLexicalChannels("quasar ledger", corpus)
    expect(channels.bm25[0].chunkIndex).toBe(2)
  })

  it("downweights an ambiguous channel using scale-independent ranking evidence", () => {
    const rankings = {
      identity: [],
      camelcase: [],
      bm25: [
        { chunkIndex: 0, score: 10 },
        { chunkIndex: 1, score: 1 },
      ],
      dense: [
        { chunkIndex: 2, score: 0.51 },
        { chunkIndex: 3, score: 0.5 },
      ],
      sparse: [],
    }
    const evidence = buildRoutingEvidence("find project configuration", rankings)
    const weights = routeWithEvidence(evidence, {
      baseWeights: { identity: 0, camelcase: 0, bm25: 1, dense: 1, sparse: 0 },
      scoreInfluence: { ...zeroChannelCoefficients, bm25: 1, dense: 1 },
      geometryInfluence: zeroChannelCoefficients,
      termCoverageInfluence: zeroChannelCoefficients,
      pairwiseAgreementInfluence: zeroChannelCoefficients,
      denseConfidenceInfluence: zeroChannelCoefficients,
      identifierInfluence: zeroChannelCoefficients,
      queryLengthInfluence: zeroChannelCoefficients,
    })

    expect(evidence.channels.bm25.scoreSeparation).toBeGreaterThan(
      evidence.channels.dense.scoreSeparation,
    )
    expect(weights.bm25).toBeGreaterThan(weights.dense)
  })

  it("applies query-length evidence differently to each channel", () => {
    const rankings = {
      identity: [{ chunkIndex: 0, score: 1 }],
      camelcase: [],
      bm25: [],
      dense: [{ chunkIndex: 1, score: 1 }],
      sparse: [],
    }
    const config = {
      baseWeights: { identity: 1, camelcase: 0, bm25: 0, dense: 1, sparse: 0 },
      scoreInfluence: zeroChannelCoefficients,
      geometryInfluence: zeroChannelCoefficients,
      termCoverageInfluence: zeroChannelCoefficients,
      pairwiseAgreementInfluence: zeroChannelCoefficients,
      denseConfidenceInfluence: zeroChannelCoefficients,
      identifierInfluence: zeroChannelCoefficients,
      queryLengthInfluence: { ...zeroChannelCoefficients, identity: -1, dense: 1 },
    }
    const shortWeights = routeWithEvidence(buildRoutingEvidence("target", rankings), config)
    const longWeights = routeWithEvidence(
      buildRoutingEvidence(
        "find the implementation that handles this target in this repository",
        rankings,
      ),
      config,
    )

    expect(shortWeights.identity).toBeGreaterThan(shortWeights.dense)
    expect(longWeights.dense).toBeGreaterThan(longWeights.identity)
  })

  it("recognizes concentrated score geometry as stronger evidence", () => {
    const rankings = {
      identity: [],
      camelcase: [],
      bm25: [
        { chunkIndex: 0, score: 10 },
        { chunkIndex: 1, score: 1 },
        { chunkIndex: 2, score: 1 },
      ],
      dense: [
        { chunkIndex: 0, score: 0.51 },
        { chunkIndex: 1, score: 0.5 },
        { chunkIndex: 2, score: 0.5 },
      ],
      sparse: [],
    }
    const evidence = buildRoutingEvidence("find the target", rankings)
    const weights = routeWithEvidence(evidence, {
      baseWeights: { identity: 0, camelcase: 0, bm25: 1, dense: 1, sparse: 0 },
      scoreInfluence: zeroChannelCoefficients,
      geometryInfluence: { ...zeroChannelCoefficients, bm25: 1, dense: 1 },
      termCoverageInfluence: zeroChannelCoefficients,
      pairwiseAgreementInfluence: zeroChannelCoefficients,
      denseConfidenceInfluence: zeroChannelCoefficients,
      identifierInfluence: zeroChannelCoefficients,
      queryLengthInfluence: zeroChannelCoefficients,
    })

    expect(evidence.channels.bm25.scoreGeometry.confidence).toBeGreaterThan(
      evidence.channels.dense.scoreGeometry.confidence,
    )
    expect(weights.bm25).toBeGreaterThan(weights.dense)
  })

  it("measures lexical and identifier query-term coverage", () => {
    const complete = buildQueryTermCoverage(
      "loadProjectConfiguration",
      corpus.bm25Index,
      corpus.identifierIndex,
    )
    const partial = buildQueryTermCoverage(
      "loadProjectConfiguration missing",
      corpus.bm25Index,
      corpus.identifierIndex,
    )

    expect(complete.bm25Idf).toBe(1)
    expect(complete.identity).toBe(1)
    expect(complete.camelcase).toBe(1)
    expect(partial.bm25Idf).toBeLessThan(1)
    expect(partial.identity).toBe(0)
    expect(partial.camelcase).toBeLessThan(1)
  })

  it("uses symmetric pairwise agreement instead of one best peer", () => {
    const rankings = {
      identity: [
        { chunkIndex: 0, score: 1 },
        { chunkIndex: 1, score: 0.9 },
      ],
      camelcase: [
        { chunkIndex: 0, score: 2 },
        { chunkIndex: 2, score: 1 },
      ],
      bm25: [
        { chunkIndex: 3, score: 2 },
        { chunkIndex: 4, score: 1 },
      ],
      dense: [
        { chunkIndex: 0, score: 0.9 },
        { chunkIndex: 5, score: 0.8 },
      ],
      sparse: [],
    }
    const evidence = buildRoutingEvidence("find target", rankings)
    const weights = routeWithEvidence(evidence, {
      baseWeights: { identity: 1, camelcase: 0, bm25: 1, dense: 0, sparse: 0 },
      scoreInfluence: zeroChannelCoefficients,
      geometryInfluence: zeroChannelCoefficients,
      termCoverageInfluence: zeroChannelCoefficients,
      pairwiseAgreementInfluence: { ...zeroChannelCoefficients, identity: 1, bm25: 1 },
      denseConfidenceInfluence: zeroChannelCoefficients,
      identifierInfluence: zeroChannelCoefficients,
      queryLengthInfluence: zeroChannelCoefficients,
    })

    expect(evidence.pairwiseAgreement.identityCamelcase).toBeGreaterThan(
      evidence.pairwiseAgreement.identityBm25,
    )
    expect(weights.identity).toBeGreaterThan(weights.bm25)
  })

  it("recognizes a dense score outlier relative to its distribution", () => {
    const rankings = (dense: readonly { chunkIndex: number; score: number }[]) => ({
      identity: [],
      camelcase: [],
      bm25: [],
      dense,
      sparse: [],
    })
    const config = {
      baseWeights: { identity: 0, camelcase: 0, bm25: 0, dense: 1, sparse: 0 },
      scoreInfluence: zeroChannelCoefficients,
      geometryInfluence: zeroChannelCoefficients,
      termCoverageInfluence: zeroChannelCoefficients,
      pairwiseAgreementInfluence: zeroChannelCoefficients,
      denseConfidenceInfluence: { ...zeroChannelCoefficients, dense: 1 },
      identifierInfluence: zeroChannelCoefficients,
      queryLengthInfluence: zeroChannelCoefficients,
    }
    const strongEvidence = buildRoutingEvidence(
      "find target",
      rankings([
        { chunkIndex: 0, score: 0.99 },
        { chunkIndex: 1, score: 0.1 },
        { chunkIndex: 2, score: 0.1 },
      ]),
    )
    const flatEvidence = buildRoutingEvidence(
      "find target",
      rankings([
        { chunkIndex: 0, score: 0.51 },
        { chunkIndex: 1, score: 0.5 },
        { chunkIndex: 2, score: 0.5 },
      ]),
    )

    expect(strongEvidence.denseConfidence.confidence).toBeGreaterThan(
      flatEvidence.denseConfidence.confidence,
    )
    expect(routeWithEvidence(strongEvidence, config).dense).toBeGreaterThan(
      routeWithEvidence(flatEvidence, config).dense,
    )
  })

  it("measures full RRF against exact file-qualified gold targets", () => {
    const query = "project configuration"
    const ranked = fuseVariant("rrf", query, {
      ...rankLexicalChannels(query, corpus),
      dense: [{ chunkIndex: 0, score: 1 }],
      sparse: [],
    })
    const targets = resolveGoldTargets(
      [{ file: "src/chunk-0.ts", symbol: "loadProjectConfiguration" }],
      chunks,
      corpus.identifiersByChunk,
    )
    expect(targets[0]).toEqual(new Set([0]))
    expect(recallAt(ranked, targets, 1)).toBe(1)
  })

  it("keeps equal-weight RRF separate from production routing", () => {
    const rankings = {
      identity: [
        { chunkIndex: 0, score: 1 },
        { chunkIndex: 1, score: 0.5 },
      ],
      camelcase: [],
      bm25: [
        { chunkIndex: 1, score: 1 },
        { chunkIndex: 0, score: 0.5 },
      ],
      dense: [],
      sparse: [],
    }
    const equal = fuseVariant("rrf-equal", "target", rankings)
    const production = fuseVariant("rrf", "target", rankings)

    expect(equal[0]?.score).toBe(equal[1]?.score)
    expect(production[0]?.score).toBeGreaterThan(production[1]?.score ?? 0)
  })

  it("fuses channel-relative scores without comparing raw score scales", () => {
    const ranked = fuseRankings(
      "relative-score",
      {
        identity: [],
        camelcase: [],
        bm25: [
          { chunkIndex: 0, score: 10 },
          { chunkIndex: 1, score: 9 },
          { chunkIndex: 2, score: 0 },
        ],
        dense: [
          { chunkIndex: 2, score: 0.6 },
          { chunkIndex: 1, score: 0.59 },
          { chunkIndex: 0, score: 0.58 },
        ],
        sparse: [],
      },
      { identity: 0, camelcase: 0, bm25: 1, dense: 1, sparse: 0 },
    )

    expect(ranked[0].chunkIndex).toBe(1)
    expect(ranked[0].score).toBeCloseTo(1.4)
  })

  it("normalizes relative scores from unsorted channel input", () => {
    const ranked = fuseRankings(
      "relative-score",
      {
        identity: [],
        camelcase: [],
        bm25: [
          { chunkIndex: 0, score: 0 },
          { chunkIndex: 1, score: 10 },
        ],
        dense: [],
        sparse: [],
      },
      { identity: 0, camelcase: 0, bm25: 1, dense: 0, sparse: 0 },
    )

    expect(ranked).toEqual([
      { chunkIndex: 1, score: 1 },
      { chunkIndex: 0, score: 0 },
    ])
  })

  it("assigns neutral DBSF evidence to a constant channel", () => {
    const ranked = fuseRankings(
      "dbsf",
      {
        identity: [{ chunkIndex: 0, score: 1 }],
        camelcase: [],
        bm25: [],
        dense: [],
        sparse: [],
      },
      { identity: 1, camelcase: 0, bm25: 0, dense: 0, sparse: 0 },
    )

    expect(ranked).toEqual([{ chunkIndex: 0, score: 0.5 }])
  })

  it("learns weights on development and attributes holdout value with Shapley", () => {
    const sample = {
      repository: "fixture",
      intentId: "fixture-001",
      queryKind: "identifier" as const,
      groupedFold: 0,
      query: "loadProjectConfiguration",
      rankings: {
        identity: [{ chunkIndex: 0, score: 1 }],
        camelcase: [{ chunkIndex: 1, score: 1 }],
        bm25: [{ chunkIndex: 2, score: 1 }],
        dense: [{ chunkIndex: 3, score: 1 }],
        sparse: [],
      },
      targets: [new Set([0])],
      chunks,
    }
    const result = optimizeWeights(
      "fixture",
      "identifier",
      "grouped-5-fold",
      "1",
      [sample],
      [sample],
    )
    expect(result.weights.identity).toBeGreaterThan(0)
    expect(result.weights.camelcase).toBe(0)
    expect(result.weights.bm25).toBe(0)
    expect(result.weights.dense).toBe(0)
    expect(result.validation.recallAt20).toBe(1)
    expect(result.shapleyRecallAt20.identity).toBe(1)
  })

  it("selects one evidence router across queries with different reliable channels", () => {
    const samples = makeEvidenceRouterSamples()

    const routerResults = optimizeEvidenceRouter(
      "fixture",
      "dbsf",
      "grouped-5-fold",
      "1",
      samples,
      samples,
    )
    expect(routerResults.map((result) => result.objective)).toEqual([...ROUTER_OBJECTIVES])
    expect(routerResults.every((result) => result.productionDevelopment.recallAt50 >= 0)).toBe(true)
    const result = selectTop20Router(routerResults)
    expect(result.fusion).toBe("dbsf")
    expect(result.config.fusion).toBe("dbsf")
    expect(result.searchDiagnostics.parameterCount).toBe(40)
    expect(Object.keys(result.searchDiagnostics.parameterLevels)).toHaveLength(40)
    expect(result.searchDiagnostics.proxyFullAgreement).toBeGreaterThanOrEqual(0)
    expect(result.searchDiagnostics.proxyFullAgreement).toBeLessThanOrEqual(1)
    expect(result.searchBaseline.algorithm).toBe("random-scout")
    expect(result.searchBaseline.seed).toBe(1)
    expect(result.searchBaseline.candidates).toBeGreaterThan(0)
    expect(result.searchBaseline.validation.recallAt20).toBeGreaterThanOrEqual(0)
    expect(
      result.holdoutBreakdown.map(({ dimension, name }) => `${dimension}:${name}`).sort(),
    ).toEqual(["query-form:naturalQuestion", "query-form:searchPhrase", "repository:fixture"])
    expect(
      result.holdoutBreakdown.every(
        ({ candidate, baseline }) => candidate.recallAt20 >= 0 && baseline.recallAt20 >= 0,
      ),
    ).toBe(true)
    expect(Object.values(result.config.baseWeights).every((weight) => weight > 0)).toBe(true)
    const influenceNames = [
      "scoreInfluence",
      "geometryInfluence",
      "termCoverageInfluence",
      "pairwiseAgreementInfluence",
      "denseConfidenceInfluence",
      "identifierInfluence",
      "queryLengthInfluence",
    ] as const
    const totalInfluence = influenceNames.reduce(
      (sum, name) =>
        sum +
        Object.values(result.config[name]).reduce(
          (coefficientSum, value) => coefficientSum + Math.abs(value),
          0,
        ),
      0,
    )
    expect(totalInfluence).toBeGreaterThan(0)
    expect(result.validation.recallAt20).toBeGreaterThan(result.staticValidation.recallAt20)
  })

  it("does not treat a guardrail-failing fallback as promotable", () => {
    const selection = selectEligibleCandidate([{ name: "fallback" }], () => false)

    expect(selection).toEqual({
      candidate: undefined,
      promotionStatus: "no-eligible-candidate",
    })
  })

  it("keeps router fitting deterministic and independent of validation samples", () => {
    const development = makeEvidenceRouterSamples()
    const first = selectTop20Router(
      optimizeEvidenceRouter("fixture", "dbsf", "grouped-5-fold", "1", development, development),
    )
    const repeat = selectTop20Router(
      optimizeEvidenceRouter("fixture", "dbsf", "grouped-5-fold", "1", development, development),
    )
    const alteredValidation = development.map((sample) => ({
      ...sample,
      targets: [new Set([0])],
    }))
    const withAlteredValidation = selectTop20Router(
      optimizeEvidenceRouter(
        "fixture",
        "dbsf",
        "grouped-5-fold",
        "1",
        development,
        alteredValidation,
      ),
    )

    expect(repeat.config).toEqual(first.config)
    expect(repeat.development).toEqual(first.development)
    expect(first.development.recallAt20).toBeGreaterThanOrEqual(first.staticDevelopment.recallAt20)
    expect(withAlteredValidation.config).toEqual(first.config)
    expect(withAlteredValidation.development).toEqual(first.development)
    expect(withAlteredValidation.staticDevelopment).toEqual(first.staticDevelopment)
  })
})
