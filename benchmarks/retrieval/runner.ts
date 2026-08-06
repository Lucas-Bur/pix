import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"

import { Effect } from "effect"

import { DEFAULT_CONFIG } from "../../src/domain/config.js"
import { MODEL_REGISTRY } from "../../src/domain/models.js"
import { FUSION_METHODS } from "../../src/domain/retrieval.js"
import { loadCorpusManifests } from "./corpus/repository.js"
import { collectBenchmarkData } from "./evaluation/collect.js"
import { assignGroupedFolds } from "./evaluation/folds.js"
import {
  OPTIMIZATION_PROFILES,
  type OptimizationProfile,
} from "./evaluation/optimization-profiles.js"
import { renderMarkdownReport } from "./evaluation/report.js"
import { runBenchmarkSearch, type BenchmarkSearchConfig } from "./evaluation/search.js"
import {
  DEFAULT_ROUTER_SEARCH_STRATEGY,
  ROUTER_SEARCH_STRATEGIES,
  type BenchmarkArtifact,
  type BenchmarkProfile,
  type CorpusManifest,
  type RouterSearchStrategyName,
  type ValidationStrategy,
} from "./evaluation/types.js"
import { getDefaultWorkerCount, resolveWorkerCount } from "./execution/candidate-evaluation-pool.js"

const CONTEXT_BUDGETS = [2_048, 4_096, 8_192, 16_384] as const

const profileConfig = (profile: BenchmarkProfile): BenchmarkSearchConfig => {
  switch (profile) {
    case "smoke":
      return {
        groupedFolds: 5,
        repositoryHoldouts: false,
        legacyDiagnostics: false,
        fusionMethods: ["dbsf"],
        routerFusionMethods: ["dbsf"],
      }
    case "develop":
      return {
        groupedFolds: 3,
        repositoryHoldouts: false,
        legacyDiagnostics: false,
        fusionMethods: ["dbsf"],
        routerFusionMethods: ["dbsf"],
      }
    case "validate":
      return {
        groupedFolds: 5,
        repositoryHoldouts: true,
        legacyDiagnostics: false,
        fusionMethods: ["dbsf"],
        routerFusionMethods: ["dbsf"],
      }
    case "full":
      return {
        groupedFolds: 5,
        repositoryHoldouts: true,
        legacyDiagnostics: false,
        fusionMethods: FUSION_METHODS,
        routerFusionMethods: FUSION_METHODS,
      }
  }
}

const selectValues = (value: string | undefined): ReadonlySet<string> | null =>
  value
    ? new Set(
        value
          .split(",")
          .map((entry) => entry.trim())
          .filter((entry) => entry !== ""),
      )
    : null

const selectManifests = (
  manifests: readonly CorpusManifest[],
  profile: BenchmarkProfile,
): Effect.Effect<readonly CorpusManifest[], Error> => {
  const selected = selectValues(process.env.PIX_BENCH_REPOS)
  if (selected) {
    const unknown = [...selected].filter((id) => !manifests.some((manifest) => manifest.id === id))
    if (unknown.length > 0)
      return Effect.fail(new Error(`Unknown PIX_BENCH_REPOS values: ${unknown.join(", ")}`))
    return Effect.succeed(manifests.filter((manifest) => selected.has(manifest.id)))
  }
  return Effect.succeed(
    profile === "smoke" ? manifests.filter((manifest) => manifest.id === "fd") : manifests,
  )
}

const selectModels = (): Effect.Effect<readonly string[], Error> => {
  const selected = selectValues(process.env.PIX_BENCH_MODELS)
  if (selected && selected.size !== 1)
    return Effect.fail(new Error("PIX_BENCH_MODELS must select exactly one embedding model"))
  const models = Object.keys(MODEL_REGISTRY).filter((model) =>
    selected ? selected.has(model) : model === "Xenova/all-MiniLM-L6-v2",
  )
  if (selected && models.length !== selected.size) {
    const unknown = [...selected].filter((model) => MODEL_REGISTRY[model] === undefined)
    return Effect.fail(new Error(`Unknown PIX_BENCH_MODELS values: ${unknown.join(", ")}`))
  }
  return Effect.succeed(models)
}

const selectOptimizationProfile = (): Effect.Effect<OptimizationProfile, Error> => {
  const requested = process.env.PIX_BENCH_OPTIMIZATION_PROFILE
  if (requested === undefined) return Effect.succeed(OPTIMIZATION_PROFILES["search-priority"])
  const selected = Object.values(OPTIMIZATION_PROFILES).find(
    (profile) => profile.name === requested,
  )
  return selected === undefined
    ? Effect.fail(new Error(`Unknown PIX_BENCH_OPTIMIZATION_PROFILE value: ${requested}`))
    : Effect.succeed(selected)
}

const isRouterSearchStrategyName = (requested: string): requested is RouterSearchStrategyName =>
  Object.keys(ROUTER_SEARCH_STRATEGIES).some((strategy) => strategy === requested)

export const resolveRouterSearchStrategy = (
  requested: string | undefined,
): RouterSearchStrategyName => {
  if (requested === undefined) return DEFAULT_ROUTER_SEARCH_STRATEGY
  if (!isRouterSearchStrategyName(requested)) {
    throw new Error(
      `Unknown PIX_BENCH_ROUTER_STRATEGY value: ${requested}; expected one of ${Object.keys(ROUTER_SEARCH_STRATEGIES).join(", ")}`,
    )
  }
  return requested
}

const selectRouterSearchStrategy = (): Effect.Effect<RouterSearchStrategyName, Error> =>
  Effect.try({
    try: () => resolveRouterSearchStrategy(process.env.PIX_BENCH_ROUTER_STRATEGY),
    catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
  })

const writeArtifact = (artifact: BenchmarkArtifact): Effect.Effect<string, Error> =>
  Effect.gen(function* () {
    const outputDirectory = path.resolve("benchmarks/results")
    yield* Effect.tryPromise({
      try: () => mkdir(outputDirectory, { recursive: true }),
      catch: (cause) => new Error("Could not create benchmark results directory", { cause }),
    })
    const stamp = artifact.generatedAt.replaceAll(":", "-")
    const outputPath = path.join(outputDirectory, `retrieval-${stamp}.json`)
    const reportPath = path.join(outputDirectory, `retrieval-${stamp}.md`)
    yield* Effect.tryPromise({
      try: () => writeFile(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8"),
      catch: (cause) => new Error(`Could not write benchmark artifact ${outputPath}`, { cause }),
    })
    yield* Effect.tryPromise({
      try: () => writeFile(reportPath, renderMarkdownReport(artifact), "utf8"),
      catch: (cause) => new Error(`Could not write benchmark report ${reportPath}`, { cause }),
    })
    return outputPath
  })

/** Run all selected repositories, embedding models, channel variants, and context budgets. */
export const runRetrievalBenchmark = (
  profile: BenchmarkProfile = "full",
): Effect.Effect<{ readonly artifact: BenchmarkArtifact; readonly outputPath: string }, Error> =>
  Effect.gen(function* () {
    const benchmarkStartedAt = performance.now()
    const config = profileConfig(profile)
    const serialSearch = process.env.PIX_BENCH_SEARCH_MODE === "serial"
    const searchOptions = serialSearch
      ? { workerCount: 0 }
      : {
          workerCount: Math.min(resolveWorkerCount(), getDefaultWorkerCount()),
          fallbackToSerial: false,
        }
    const optimizationProfile = yield* selectOptimizationProfile()
    const routerSearchStrategy = yield* selectRouterSearchStrategy()
    const groupedStrategy: ValidationStrategy =
      config.groupedFolds === 3 ? "grouped-3-fold" : "grouped-5-fold"
    const manifests = yield* selectManifests(yield* loadCorpusManifests(), profile)
    const groupedFoldAssignments = assignGroupedFolds(manifests, config.groupedFolds)
    const models = yield* selectModels()
    const collected = yield* collectBenchmarkData(manifests, models, groupedFoldAssignments)
    const {
      chunkTokens,
      repositories,
      embeddingRuns,
      sparseEmbeddingRuns,
      measurements,
      sampleGroups,
      samplesByModel,
      retrievalDurationMs,
    } = collected
    const search = yield* runBenchmarkSearch(
      config,
      sampleGroups,
      samplesByModel,
      groupedStrategy,
      optimizationProfile,
      serialSearch,
      { ...searchOptions, routerSearchStrategy },
    )

    const embeddingDurationMs = embeddingRuns.reduce(
      (sum, run) => sum + run.chunkEmbeddingDurationMs + run.queryEmbeddingDurationMs,
      0,
    )
    const corpusPreparationDurationMs = repositories.reduce(
      (sum, repository) => sum + repository.preparationDurationMs,
      0,
    )

    const artifact: BenchmarkArtifact = {
      schemaVersion: 26,
      benchmarkProfile: profile,
      optimizationProfile,
      validationProtocol: {
        selection: "development-only",
        holdouts:
          config.repositoryHoldouts && repositories.length > 1
            ? [groupedStrategy, "leave-one-repository-out"]
            : [groupedStrategy],
        finalTest: {
          kind: "untouched-grouped-fold",
          strategy: groupedStrategy,
          fold: String(config.groupedFolds),
        },
      },
      generatedAt: new Date().toISOString(),
      searchStrategy: ROUTER_SEARCH_STRATEGIES[routerSearchStrategy],
      timings: {
        totalDurationMs: performance.now() - benchmarkStartedAt,
        corpusPreparationDurationMs,
        embeddingDurationMs,
        retrievalDurationMs,
        weightSearchDurationMs: search.weightSearchDurationMs,
        fusionSearchDurationMs: search.fusionSearchDurationMs,
        evidenceRouterSearchDurationMs: search.evidenceRouterSearchDurationMs,
        candidateQueueStartupDurationMs: search.candidateQueueStartupDurationMs,
        candidateQueueShutdownDurationMs: search.candidateQueueShutdownDurationMs,
      },
      chunkConfig: {
        chunkTokens,
        overlapLines: DEFAULT_CONFIG.overlapLines,
      },
      contextTokenEstimator: "utf8-bytes-divided-by-four",
      contextBudgets: CONTEXT_BUDGETS,
      models,
      repositories,
      evaluationCases: manifests.flatMap((manifest) =>
        manifest.questions.map((question) => ({
          repository: manifest.id,
          questionId: question.id,
          queries: question.queries,
          groundTruth: question.groundTruth,
        })),
      ),
      embeddingRuns,
      sparseEmbeddingRuns,
      measurements,
      weightSearch: search.weightSearch,
      recommendedWeights: search.recommendedWeights,
      productionRouterSearch: search.productionRouterSearch,
      fusionSearch: search.fusionSearch,
      recommendedFusionWeights: search.recommendedFusionWeights,
      evidenceRouterSearch: search.evidenceRouterSearch,
      recommendedEvidenceRouters: search.recommendedEvidenceRouters,
      promotionEvidence: search.promotionEvidence,
    }
    const outputPath = yield* writeArtifact(artifact)
    return { artifact, outputPath }
  })
