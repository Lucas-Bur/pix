import { availableParallelism } from "node:os"

import { describe, expect, it } from "@effect/vitest"

import type { Chunk } from "../../src/domain/chunk.js"
import { prepareFusion } from "../retrieval/fusion.js"
import { SEARCH_PRIORITY_PROFILE } from "../retrieval/optimization-profiles.js"
import {
  runEvidenceRouterJobs,
  type EvidenceRouterFitAllJob,
  type EvidenceRouterHoldoutJob,
} from "../retrieval/router-job-pool.js"
import {
  fitRecommendedEvidenceRouter,
  fitRecommendedFusionWeights,
  fitRecommendedFusionWeightsParallel,
  fitRecommendedWeights,
  fitRecommendedWeightsParallel,
  optimizeEvidenceRouter,
  optimizeFusionWeights,
  summarize,
} from "../retrieval/weight-search.js"
import {
  createCandidateEvaluationPool,
  createCandidateEvaluationPoolOnQueue,
  createCandidateEvaluationQueue,
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

const withoutSearchTimings = <
  T extends { readonly searchDiagnostics: { readonly timings: object } },
>(
  result: T,
) => {
  const { timings: _timings, ...searchDiagnostics } = result.searchDiagnostics
  return { ...result, searchDiagnostics }
}

describe("benchmark candidate evaluation pool", () => {
  it("runs holdout and fit-all jobs through one native queue", async () => {
    const holdoutJob: EvidenceRouterHoldoutJob = {
      kind: "holdout",
      model: "fixture",
      fusion: "dbsf",
      strategy: "grouped-5-fold",
      fold: "1",
      development: [searchSample],
      validation: [searchSample],
    }
    const fitAllJob: EvidenceRouterFitAllJob = {
      kind: "fit-all",
      model: "fixture",
      fusion: "dbsf",
      samples: [searchSample],
    }
    const candidateQueue = await createCandidateEvaluationQueue({ workerCount: 2 })
    try {
      const [parallelHoldout, parallelFitAll] = await runEvidenceRouterJobs(
        [holdoutJob, fitAllJob],
        SEARCH_PRIORITY_PROFILE,
        {
          workerCount: 2,
          candidateQueue,
        },
      )
      const serialHoldout = await optimizeEvidenceRouter(
        holdoutJob.model,
        holdoutJob.fusion,
        holdoutJob.strategy,
        holdoutJob.fold,
        holdoutJob.development,
        holdoutJob.validation,
        SEARCH_PRIORITY_PROFILE,
      )
      const serialFitAll = await fitRecommendedEvidenceRouter(
        fitAllJob.model,
        fitAllJob.fusion,
        fitAllJob.samples,
        SEARCH_PRIORITY_PROFILE,
      )

      expect(parallelHoldout.jobId).toBe(0)
      expect(parallelHoldout.kind).toBe("holdout")
      expect(parallelHoldout.results.map(withoutSearchTimings)).toEqual(
        serialHoldout.map(withoutSearchTimings),
      )
      expect(parallelFitAll.jobId).toBe(1)
      expect(parallelFitAll.kind).toBe("fit-all")
      expect(parallelFitAll.results.map(withoutSearchTimings)).toEqual(
        serialFitAll.map(withoutSearchTimings),
      )
      expect(
        parallelHoldout.results[0]?.searchDiagnostics.timings.candidateEvaluationMs,
      ).toBeGreaterThan(0)
    } finally {
      await candidateQueue.close()
    }
  })

  it("derives a bounded default and honors explicit sizing", () => {
    expect(getDefaultWorkerCount()).toBeGreaterThanOrEqual(1)
    expect(getDefaultWorkerCount()).toBeLessThanOrEqual(availableParallelism())
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

  it("shares one queue across independent snapshots without changing results", async () => {
    const queue = await createCandidateEvaluationQueue({ workerCount: 2, batchSize: 1 })
    const secondSnapshot = createEvaluationSnapshot([
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
    const firstPool = createCandidateEvaluationPoolOnQueue(snapshot, queue)
    const secondPool = createCandidateEvaluationPoolOnQueue(secondSnapshot, queue)
    try {
      const [firstResults, secondResults] = await Promise.all([
        firstPool.evaluate(candidates),
        secondPool.evaluate(candidates),
      ])
      expect(firstResults).toEqual(evaluateCandidatesSerial(snapshot, candidates))
      expect(secondResults).toEqual(evaluateCandidatesSerial(secondSnapshot, candidates))
      expect(queue.activeWorkerCount()).toBe(0)
    } finally {
      await firstPool.close()
      await secondPool.close()
      await queue.close()
    }
  })

  it("rejects an aborted queue request without closing the shared queue", async () => {
    const queue = await createCandidateEvaluationQueue({ workerCount: 2, batchSize: 1 })
    const controller = new AbortController()
    try {
      const pending = queue.evaluate(snapshot, candidates, controller.signal)
      controller.abort()
      await expect(pending).rejects.toThrow("interrupted")
      await expect(queue.evaluate(snapshot, candidates.slice(0, 1))).resolves.toHaveLength(1)
    } finally {
      await queue.close()
    }
  })

  it("keeps worker metrics aligned with canonical summarization", () => {
    const parityRankings = {
      ...rankings,
      dense: [...rankings.dense, { chunkIndex: 99, score: 0.25 }],
    }
    const paritySamples = [
      {
        ...searchSample,
        rankings: parityRankings,
        targets: [new Set([0])],
        queryKind: "identifier" as const,
      },
      {
        ...searchSample,
        intentId: "fixture-002",
        rankings: parityRankings,
        targets: [new Set([3])],
        queryKind: "searchPhrase" as const,
      },
    ]
    const weights = { identity: 1, camelcase: 1, bm25: 1, dense: 1, sparse: 1 }
    const snapshot = createEvaluationSnapshot(
      paritySamples.map((sample) => ({
        evaluator: prepareFusion("dbsf", sample.rankings),
        targets: sample.targets,
        chunks: sample.chunks,
        sampleWeight: SEARCH_PRIORITY_PROFILE.queryFormWeights[sample.queryKind],
      })),
    )

    expect(evaluateCandidatesSerial(snapshot, [{ weights }])[0]).toEqual(
      summarize(paritySamples, weights, "dbsf", SEARCH_PRIORITY_PROFILE),
    )
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
