import { readFileSync } from "node:fs"

import { describe, expect, it } from "@effect/vitest"
import { Schema } from "effect"

import type { BenchmarkTimings, RouterSearchDiagnostics } from "../retrieval/evaluation/types.js"
import {
  BenchmarkMatrixPlanSchema,
  benchmarkMatrixCoordinates,
  benchmarkMatrixInvocations,
  BenchmarkMatrixManifestSchema,
  expandBenchmarkMatrixManifest,
  mergeBenchmarkMatrix,
  type BenchmarkMatrixCoordinate,
  type MatrixSearchResult,
  type MatrixSourceArtifact,
} from "../retrieval/matrix.js"

const timings: BenchmarkTimings = {
  totalDurationMs: 100,
  corpusPreparationDurationMs: 10,
  embeddingDurationMs: 20,
  retrievalDurationMs: 30,
  fusionSearchDurationMs: 5,
  evidenceRouterSearchDurationMs: 25,
  candidateQueueStartupDurationMs: 2,
  candidateQueueShutdownDurationMs: 1,
  artifactSerializationDurationMs: 2,
}

const searchDiagnostics: RouterSearchDiagnostics = {
  parameterCount: 1,
  parameterLevels: { identity: [1] },
  rawCandidates: 1,
  uniqueCandidates: 1,
  proxyEvaluations: 1,
  fullEvaluations: 1,
  proxyCacheHits: 0,
  fullCacheHits: 0,
  proxyPromotions: 1,
  proxyFullAgreement: 1,
  protectedEliteCount: 1,
  localCloudCandidates: 0,
  timings: {
    preparationMs: 1,
    candidatePoolInitializationMs: 1,
    baseWeightSearchMs: 1,
    funnelSearchMs: 1,
    candidatePreparationMs: 1,
    candidateEvaluationMs: 1,
    candidateSelectionMs: 1,
  },
}

const result = (fold: string): MatrixSearchResult => ({
  model: "fixture-model",
  fusion: "dbsf",
  objective: "direct",
  strategy: "grouped-3-fold",
  fold,
  searchDiagnostics,
})

const artifact = (
  results: readonly MatrixSearchResult[],
  repositories: readonly string[] = ["fd"],
): MatrixSourceArtifact<MatrixSearchResult> => ({
  benchmarkProfile: "develop",
  optimizationProfile: { name: "search-priority" },
  generatedAt: "2026-08-26T00:00:00.000Z",
  timings,
  repositories: repositories.map((id) => ({
    id,
    repository: `owner/${id}`,
    revision: "abc123",
    chunks: 10,
    preparationDurationMs: 1,
  })),
  evidenceRouterSearch: results,
})

const coordinate = (fold: string, repository = "fd"): BenchmarkMatrixCoordinate => ({
  benchmarkProfile: "develop",
  optimizationProfile: "search-priority",
  model: "fixture-model",
  repository,
  fusion: "dbsf",
  objective: "direct",
  validationStrategy: "grouped-3-fold",
  fold,
})

describe("benchmark matrix", () => {
  it("expands the checked-in full manifest to all 12,960 expected coordinates", () => {
    const manifestInput: unknown = JSON.parse(
      readFileSync(new URL("../matrix/full.json", import.meta.url), "utf8"),
    )
    const manifest = Schema.decodeUnknownSync(BenchmarkMatrixManifestSchema)(manifestInput)
    const plan = expandBenchmarkMatrixManifest(manifest)

    expect(plan.coordinates).toHaveLength(12_960)
    expect(benchmarkMatrixInvocations(manifest)).toHaveLength(30)
    expect(new Set(plan.coordinates.map((entry) => entry.optimizationProfile))).toEqual(
      new Set([
        "search-priority",
        "balanced",
        "code-navigation",
        "basic-exploration",
        "natural-language",
      ]),
    )
    expect(new Set(plan.coordinates.map((entry) => entry.validationStrategy))).toEqual(
      new Set(["grouped-3-fold", "grouped-5-fold", "leave-one-repository-out"]),
    )
  })

  it("expands and merges every explicit coordinate in stable order", () => {
    const source = artifact([result("2"), result("1")], ["fd", "fastapi"])
    expect(benchmarkMatrixCoordinates(source)).toHaveLength(4)

    const plan = Schema.decodeUnknownSync(BenchmarkMatrixPlanSchema)({
      schemaVersion: 1,
      coordinates: [
        coordinate("2", "fastapi"),
        coordinate("1", "fd"),
        coordinate("2", "fd"),
        coordinate("1", "fastapi"),
      ],
    })
    const merged = mergeBenchmarkMatrix(plan, [source])

    expect(merged.coordinates.map((entry) => entry.coordinate)).toEqual([
      coordinate("1", "fastapi"),
      coordinate("2", "fastapi"),
      coordinate("1", "fd"),
      coordinate("2", "fd"),
    ])
    expect(merged.coordinates[0].sourceTimings.artifactSerializationDurationMs).toBe(2)
    expect(merged.coordinates[0].result.searchDiagnostics).toBe(searchDiagnostics)
  })

  it("rejects missing coordinates", () => {
    const plan = { schemaVersion: 1, coordinates: [coordinate("1"), coordinate("2")] } as const
    expect(() => mergeBenchmarkMatrix(plan, [artifact([result("1")])])).toThrow(
      "Missing benchmark artifact coordinates",
    )
  })

  it("rejects duplicate artifact coordinates", () => {
    const plan = { schemaVersion: 1, coordinates: [coordinate("1")] } as const
    const source = artifact([result("1")])
    expect(() => mergeBenchmarkMatrix(plan, [source, source])).toThrow(
      "Duplicate benchmark artifact coordinate",
    )
  })

  it("rejects unexpected coordinates", () => {
    const plan = { schemaVersion: 1, coordinates: [coordinate("1")] } as const
    expect(() => mergeBenchmarkMatrix(plan, [artifact([result("2")])])).toThrow(
      "Unexpected benchmark artifact coordinate",
    )
  })
})
