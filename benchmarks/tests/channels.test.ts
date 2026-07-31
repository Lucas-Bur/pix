import { describe, expect, it } from "@effect/vitest"

import type { Chunk } from "../../src/domain/chunk.js"
import { buildBm25Index } from "../../src/lib/retrieval/bm25.js"
import { buildIdentifierIndex } from "../../src/lib/retrieval/identifier-index.js"
import { buildRoutingEvidence, routeWithEvidence } from "../retrieval/evidence-router.js"
import { recallAt, resolveGoldTargets } from "../retrieval/metrics.js"
import type { PreparedCorpus } from "../retrieval/prepare.js"
import { rankChannels, rankVariant, RETRIEVAL_VARIANTS } from "../retrieval/ranking.js"
import { optimizeEvidenceRouter, optimizeWeights } from "../retrieval/weight-search.js"

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

const chunkVectors = [
  new Float32Array([0.6, 0.4]),
  new Float32Array([0.2, 0.8]),
  new Float32Array([0, 1]),
  new Float32Array([1, 0]),
]

const zeroChannelCoefficients = { identity: 0, camelcase: 0, bm25: 0, dense: 0 }

describe("retrieval benchmark fixture", () => {
  it("covers every non-empty subset of four channels", () => {
    expect(new Set(RETRIEVAL_VARIANTS).size).toBe(15)
  })

  it("isolates the exact identity channel without prefix false positives", () => {
    const channels = rankChannels(
      "loadProjectConfiguration",
      corpus,
      chunkVectors,
      new Float32Array([0, 1]),
    )
    expect(channels.identity.map((entry) => entry.chunkIndex)).toEqual([0])
    expect(channels.identity.some((entry) => entry.chunkIndex === 1)).toBe(false)
  })

  it("ranks the identifier matching both constituent words first", () => {
    const channels = rankChannels(
      "project configuration",
      corpus,
      chunkVectors,
      new Float32Array([0, 1]),
    )
    expect(channels.camelcase[0].chunkIndex).toBe(0)
    expect(channels.camelcase[0].score).toBe(2)
  })

  it("finds rare lexical terms through BM25", () => {
    const channels = rankChannels("quasar ledger", corpus, chunkVectors, new Float32Array([0, 1]))
    expect(channels.bm25[0].chunkIndex).toBe(2)
  })

  it("finds a semantic target through dense vectors", () => {
    const channels = rankChannels(
      "who checks the logged-in user",
      corpus,
      chunkVectors,
      new Float32Array([1, 0]),
    )
    expect(channels.dense[0].chunkIndex).toBe(3)
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
    }
    const evidence = buildRoutingEvidence("find project configuration", rankings)
    const weights = routeWithEvidence(evidence, {
      baseWeights: { identity: 0, camelcase: 0, bm25: 1, dense: 1 },
      scoreInfluence: { ...zeroChannelCoefficients, bm25: 1, dense: 1 },
      agreementInfluence: zeroChannelCoefficients,
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
    }
    const config = {
      baseWeights: { identity: 1, camelcase: 0, bm25: 0, dense: 1 },
      scoreInfluence: zeroChannelCoefficients,
      agreementInfluence: zeroChannelCoefficients,
      identifierInfluence: zeroChannelCoefficients,
      queryLengthInfluence: { ...zeroChannelCoefficients, identity: -1, dense: 1 },
    }
    const shortWeights = routeWithEvidence(buildRoutingEvidence("target", rankings), config)
    const longWeights = routeWithEvidence(
      buildRoutingEvidence("find the implementation that handles this target", rankings),
      config,
    )

    expect(shortWeights.identity).toBeGreaterThan(shortWeights.dense)
    expect(longWeights.dense).toBeGreaterThan(longWeights.identity)
  })

  it("measures full RRF against exact file-qualified gold targets", () => {
    const ranked = rankVariant(
      "rrf",
      "project configuration",
      corpus,
      chunkVectors,
      new Float32Array([0.6, 0.4]),
    )
    const targets = resolveGoldTargets(
      [{ file: "src/chunk-0.ts", symbol: "loadProjectConfiguration" }],
      chunks,
      corpus.identifiersByChunk,
    )
    expect(targets[0]).toEqual(new Set([0]))
    expect(recallAt(ranked, targets, 1)).toBe(1)
  })

  it("learns weights on development and attributes holdout value with Shapley", () => {
    const sample = {
      repository: "fixture",
      intentId: "fixture-001",
      groupedFold: 0,
      query: "loadProjectConfiguration",
      rankings: {
        identity: [{ chunkIndex: 0, score: 1 }],
        camelcase: [{ chunkIndex: 1, score: 1 }],
        bm25: [{ chunkIndex: 2, score: 1 }],
        dense: [{ chunkIndex: 3, score: 1 }],
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
    const samples = [
      {
        repository: "fixture",
        intentId: "fixture-bm25",
        groupedFold: 0,
        query: "find lexical target",
        rankings: {
          identity: [],
          camelcase: [],
          bm25: ranked(90, 0, true),
          dense: ranked(90, 30, false),
        },
        targets: [new Set([90])],
        chunks: evidenceChunks,
      },
      {
        repository: "fixture",
        intentId: "fixture-dense",
        groupedFold: 1,
        query: "find semantic target",
        rankings: {
          identity: [],
          camelcase: [],
          bm25: ranked(91, 0, false),
          dense: ranked(91, 30, true),
        },
        targets: [new Set([91])],
        chunks: evidenceChunks,
      },
    ]

    const result = optimizeEvidenceRouter("fixture", "grouped-5-fold", "1", samples, samples)

    expect(Object.values(result.config.baseWeights).every((weight) => weight > 0)).toBe(true)
    expect(result.config.scoreInfluence.bm25 + result.config.scoreInfluence.dense).toBeGreaterThan(
      0,
    )
    expect(result.validation.recallAt20).toBeGreaterThan(result.staticValidation.recallAt20)
  })
})
