import { expect, it } from "@effect/vitest"

import { SEARCH_PRIORITY_PROFILE } from "../retrieval/evaluation/optimization-profiles.js"
import { renderMarkdownReport } from "../retrieval/evaluation/report.js"
import { ROUTER_SEARCH_STRATEGIES, type BenchmarkArtifact } from "../retrieval/evaluation/types.js"

const artifact = {
  schemaVersion: 26,
  benchmarkProfile: "smoke",
  optimizationProfile: SEARCH_PRIORITY_PROFILE,
  validationProtocol: {
    selection: "development-only",
    holdouts: ["grouped-5-fold"],
    finalTest: { kind: "untouched-grouped-fold", strategy: "grouped-5-fold", fold: "5" },
  },
  generatedAt: "2026-08-06T00:00:00.000Z",
  searchStrategy: ROUTER_SEARCH_STRATEGIES["proxy-promotion"],
  timings: {
    totalDurationMs: 0,
    corpusPreparationDurationMs: 0,
    embeddingDurationMs: 0,
    retrievalDurationMs: 0,
    weightSearchDurationMs: 0,
    fusionSearchDurationMs: 0,
    evidenceRouterSearchDurationMs: 0,
    candidateQueueStartupDurationMs: 0,
    candidateQueueShutdownDurationMs: 0,
  },
  chunkConfig: { chunkTokens: 512, overlapLines: 0 },
  contextTokenEstimator: "utf8-bytes-divided-by-four",
  contextBudgets: [2_048, 4_096],
  models: ["fixture-model"],
  repositories: [],
  evaluationCases: [],
  embeddingRuns: [],
  sparseEmbeddingRuns: [],
  measurements: [
    {
      repository: "fixture",
      language: "TypeScript",
      size: "small",
      revision: "abc123",
      model: "fixture-model",
      variant: "rrf",
      questionId: "fixture-1",
      queryKind: "agentTask",
      query: "find target",
      category: "navigation",
      difficulty: "easy",
      groupedFold: 1,
      recallAt5: 1,
      recallAt10: 1,
      recallAt20: 1,
      recallAt50: 1,
      ndcgAt5: 0.5,
      ndcgAt10: 0.6,
      ndcgAt20: 0.7,
      ndcgAt50: 0.8,
      successAt10: true,
      successAt20: true,
      reciprocalRank: 0.5,
      goldRanks: [2],
      contextRecall: { "2048": 1, "4096": 1 },
      queryDurationMs: 0,
    },
  ],
  weightSearch: [],
  recommendedWeights: [],
  productionRouterSearch: [],
  fusionSearch: [],
  recommendedFusionWeights: [],
  evidenceRouterSearch: [],
  recommendedEvidenceRouters: [],
  promotionEvidence: [],
} satisfies BenchmarkArtifact

it("renders the complete NDCG and direct-objective contract", () => {
  const report = renderMarkdownReport(artifact)

  expect(report).toContain("NDCG@5 | NDCG@10 | NDCG@20 | NDCG@50")
  expect(report).toContain("| 50.0% | 60.0% | 70.0% | 80.0% |")
  expect(report).toContain("`direct` objective selects NDCG@5 first")
  expect(report).toContain("Recall-first direct-ablation")
  expect(report).toContain("reranker-top20")
  expect(report).toContain("reranker-top50")
})
