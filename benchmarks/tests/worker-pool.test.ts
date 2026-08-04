import { availableParallelism } from "node:os"

import { describe, expect, it } from "@effect/vitest"

import type { Chunk } from "../../src/domain/chunk.js"
import { prepareFusion } from "../retrieval/fusion.js"
import {
  fitRecommendedEvidenceRouter,
  fitRecommendedFusionWeights,
  fitRecommendedFusionWeightsParallel,
  fitRecommendedWeights,
  fitRecommendedWeightsParallel,
  optimizeFusionWeights,
} from "../retrieval/weight-search.js"
import {
  createCandidateEvaluationPool,
  createEvaluationSnapshot,
  evaluateCandidatesSerial,
  getDefaultWorkerCount,
  resolveWorkerCount,
  type EvaluationCandidate,
} from "../retrieval/worker-pool.js"

const chunks: readonly Chunk[] = [0, 1, 2, 3].map((index) => ({
  id: String(index),
  idx: index,
  file: `src/chunk-${index}.ts`,
  startLine: 1,
  endLine: 1,
  startOffset: 0,
  endOffset: 32,
  text: `export function target${index}() { return ${index} }`,
}))

const rankings = {
  identity: [
    { chunkIndex: 0, score: 1 },
    { chunkIndex: 1, score: 0.5 },
  ],
  camelcase: [{ chunkIndex: 1, score: 1 }],
  bm25: [
    { chunkIndex: 2, score: 4 },
    { chunkIndex: 3, score: 1 },
  ],
  dense: [{ chunkIndex: 3, score: 1 }],
  sparse: [],
}

const snapshot = createEvaluationSnapshot([
  {
    evaluator: prepareFusion("dbsf", rankings, 10),
    targets: [new Set([0])],
    chunks,
    sampleWeight: 1,
  },
  {
    evaluator: prepareFusion("dbsf", rankings, 10),
    targets: [new Set([3])],
    chunks,
    sampleWeight: 2,
  },
])

const candidates: readonly EvaluationCandidate[] = [
  { weights: { identity: 1, camelcase: 0, bm25: 0, dense: 0, sparse: 0 } },
  { weights: { identity: 0, camelcase: 0, bm25: 1, dense: 0, sparse: 0 } },
  { weights: { identity: 0, camelcase: 0, bm25: 0, dense: 1, sparse: 0 } },
  {
    weights: [
      { identity: 1, camelcase: 0, bm25: 0, dense: 0, sparse: 0 },
      { identity: 0, camelcase: 0, bm25: 0, dense: 1, sparse: 0 },
    ],
  },
  { weights: { identity: 1, camelcase: 1, bm25: 1, dense: 1, sparse: 1 } },
]

const searchSample = {
  repository: "fixture",
  intentId: "fixture-001",
  queryKind: "identifier" as const,
  groupedFold: 0,
  query: "target0",
  rankings,
  targets: [new Set([0])],
  chunks,
}

describe("benchmark candidate evaluation pool", () => {
  it("derives a bounded default and honors explicit sizing", () => {
    expect(getDefaultWorkerCount()).toBe(Math.max(1, availableParallelism() - 1))
    expect(resolveWorkerCount(0)).toBe(0)
    expect(resolveWorkerCount(3)).toBe(3)
  })

  it("matches serial quality exactly and preserves candidate order", async () => {
    const serial = evaluateCandidatesSerial(snapshot, candidates)
    const pool = await createCandidateEvaluationPool(snapshot, {
      workerCount: 2,
      batchSize: 2,
    })
    try {
      await expect(pool.evaluate(candidates)).resolves.toEqual(serial)
      expect(pool.stats()).toMatchObject({
        mode: "parallel",
        workerCount: 2,
        batchSize: 2,
        batches: 3,
        candidates: candidates.length,
      })
    } finally {
      await pool.close()
    }
    expect(pool.stats().activeWorkerCount).toBe(0)
  })

  it("keeps the explicit parallel search result equal to the serial search", async () => {
    const serial = await fitRecommendedWeights("fixture", "identifier", [searchSample])
    const parallel = await fitRecommendedWeightsParallel(
      "fixture",
      "identifier",
      [searchSample],
      undefined,
      { workerCount: 2, batchSize: 16 },
    )

    expect(parallel).toEqual(serial)
  })

  it("keeps static fusion fitting serial and parallel paths equivalent", async () => {
    const serial = await fitRecommendedFusionWeights("fixture", "dbsf", [searchSample])
    const parallel = await fitRecommendedFusionWeightsParallel(
      "fixture",
      "dbsf",
      [searchSample],
      undefined,
      { workerCount: 2, batchSize: 16 },
    )

    expect(parallel).toEqual(serial)

    const foldResult = await optimizeFusionWeights(
      "fixture",
      "dbsf",
      "grouped-5-fold",
      "1",
      [searchSample],
      [searchSample],
    )
    expect(foldResult.developmentQueries).toBe(1)
  })

  it("retains the serial evidence-router fit path", async () => {
    const result = await fitRecommendedEvidenceRouter("fixture", "dbsf", [searchSample])

    expect(result).toHaveLength(3)
    expect(result.every((candidate) => candidate.fitQuality.recallAt20 >= 0)).toBe(true)
  })

  it("uses serial fallback for a one-worker configuration", async () => {
    const pool = await createCandidateEvaluationPool(snapshot, {
      workerCount: 1,
      batchSize: 2,
    })
    try {
      await expect(pool.evaluate(candidates)).resolves.toEqual(
        evaluateCandidatesSerial(snapshot, candidates),
      )
      expect(pool.stats()).toMatchObject({ mode: "serial", workerCount: 1, batches: 3 })
    } finally {
      await pool.close()
    }
  })

  it("falls back to serial evaluation when worker startup is unavailable", async () => {
    const unavailableWorkerUrl = new URL("../retrieval/fusion-worker.mjs", import.meta.url)
    unavailableWorkerUrl.pathname += ".missing"
    const pool = await createCandidateEvaluationPool(snapshot, {
      workerCount: 2,
      workerUrl: unavailableWorkerUrl,
      fallbackToSerial: true,
    })
    try {
      expect(pool.mode).toBe("serial")
      await expect(pool.evaluate(candidates)).resolves.toEqual(
        evaluateCandidatesSerial(snapshot, candidates),
      )
    } finally {
      await pool.close()
    }
  })

  it("terminates the pool when a worker reports an evaluation error", async () => {
    const pool = await createCandidateEvaluationPool(snapshot, { workerCount: 2, batchSize: 1 })
    try {
      await expect(pool.evaluate([{ weights: [] }])).rejects.toThrow("Missing weights")
      expect(pool.stats().activeWorkerCount).toBe(0)
    } finally {
      await pool.close()
    }
    await expect(pool.evaluate(candidates)).rejects.toThrow("closed")
  })
})
