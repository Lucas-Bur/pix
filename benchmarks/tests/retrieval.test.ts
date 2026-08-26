import { expect, it } from "@effect/vitest"
import { Effect } from "effect"

import { assignGroupedFolds } from "../retrieval/evaluation/folds.js"
import { resolveScoutSequence } from "../retrieval/evaluation/scouts/index.js"
import {
  DEFAULT_ROUTER_SEARCH_STRATEGY_PARAMETERS,
  ROUTER_OBJECTIVES,
  routerSearchStrategyFor,
  type BenchmarkProfile,
} from "../retrieval/evaluation/types.js"
import { resolveRouterSearchStrategy, runRetrievalBenchmark } from "../retrieval/runner.js"

const foldQuestions = (prefix: string) =>
  Array.from({ length: 12 }, (_, index) => ({
    id: `${prefix}-${index + 1}`,
    queries: {
      identifier: "",
      searchPhrase: "",
      naturalQuestion: "",
      agentTask: "",
    },
    category: ["architecture", "routing", "symbol-lookup"][Math.floor(index / 4)],
    difficulty: ["easy", "medium", "hard"][index % 3] as "easy" | "medium" | "hard",
    groundTruth: [{ file: "src/fixture.ts", symbol: `target${index + 1}` }] as const,
  }))

type TestQuestion = ReturnType<typeof foldQuestions>[number]
type TestManifest = { readonly id: string; readonly questions: readonly TestQuestion[] }
const runRetrievalBenchmarks = process.env.PIX_RUN_RETRIEVAL_BENCHMARK === "1"

const expectBalancedClass = (
  manifest: TestManifest,
  assignments: ReadonlyMap<string, number>,
  className: string,
  select: (question: TestQuestion) => string,
): void => {
  const counts = [0, 0, 0]
  for (const question of manifest.questions) {
    if (select(question) !== className) continue
    const fold = assignments.get(`${manifest.id}\0${question.id}`)
    if (fold === undefined) throw new Error(`Missing fold for ${question.id}`)
    counts[fold]++
  }
  expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1)
}

const expectStratifiedClasses = (
  manifests: readonly TestManifest[],
  assignments: ReadonlyMap<string, number>,
): void => {
  const categories = ["architecture", "routing", "symbol-lookup"]
  const difficulties = ["easy", "medium", "hard"]
  const checks = manifests.flatMap((manifest) => [
    ...categories.map((className) => ({
      manifest,
      className,
      select: (question: TestQuestion) => question.category,
    })),
    ...difficulties.map((className) => ({
      manifest,
      className,
      select: (question: TestQuestion) => question.difficulty,
    })),
  ])
  for (const check of checks)
    expectBalancedClass(check.manifest, assignments, check.className, check.select)
}

const runProfile = (profile: BenchmarkProfile, groupedFolds: number, fusionMethods: number) =>
  Effect.gen(function* () {
    const previousOptimizationProfile = process.env.PIX_BENCH_OPTIMIZATION_PROFILE
    process.env.PIX_BENCH_OPTIMIZATION_PROFILE = "search-priority"
    const { artifact, outputPath } = yield* runRetrievalBenchmark(profile).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          if (previousOptimizationProfile === undefined)
            delete process.env.PIX_BENCH_OPTIMIZATION_PROFILE
          else process.env.PIX_BENCH_OPTIMIZATION_PROFILE = previousOptimizationProfile
        }),
      ),
    )
    const repositoryHoldouts =
      (profile === "validate" || profile === "full") && artifact.repositories.length > 1
        ? artifact.repositories.length
        : 0
    const holdoutsPerModel = groupedFolds + repositoryHoldouts
    const routerFusionMethods = profile === "full" ? 3 : 1

    expect(artifact.benchmarkProfile).toBe(profile)
    expect(artifact.optimizationProfile.queryFormWeights).toEqual({
      identifier: 1,
      agentTask: 2,
      naturalQuestion: 3,
      searchPhrase: 4,
    })
    expect(artifact.validationProtocol.selection).toBe("development-only")
    expect(artifact.validationProtocol.finalTest).toEqual({
      kind: "untouched-grouped-fold",
      strategy: groupedFolds === 3 ? "grouped-3-fold" : "grouped-5-fold",
      fold: String(groupedFolds),
    })
    expect(artifact.repositories.length).toBeGreaterThan(0)
    expect(artifact.evaluationCases.length).toBeGreaterThan(0)
    expect(artifact.evaluationCases.every(({ groundTruth }) => groundTruth.length > 0)).toBe(true)
    expect(artifact.models.length).toBeGreaterThan(0)
    expect(artifact.measurements.length).toBeGreaterThan(0)
    expect(artifact.schemaVersion).toBe(31)
    expect(artifact.scoutSequence).toBe(resolveScoutSequence(process.env.PIX_BENCH_SCOUT_SEQUENCE))
    expect(artifact.seedHypotheses).toBe(
      process.env.PIX_BENCH_SEED_HYPOTHESES === "1" ||
        process.env.PIX_BENCH_SEED_HYPOTHESES === "true",
    )
    expect(artifact.beamSchedule).toBe(process.env.PIX_BENCH_BEAM_SCHEDULE ?? "fixed")
    expect(artifact.globalScouts).toBe(
      process.env.PIX_BENCH_GLOBAL_SCOUTS === undefined
        ? 64
        : Number.parseInt(process.env.PIX_BENCH_GLOBAL_SCOUTS, 10),
    )
    expect(artifact.coordinatePasses).toBe(
      process.env.PIX_BENCH_COORDINATE_PASSES === undefined
        ? 2
        : Number.parseInt(process.env.PIX_BENCH_COORDINATE_PASSES, 10),
    )
    expect(artifact.searchStrategy).toEqual(
      routerSearchStrategyFor(
        resolveScoutSequence(process.env.PIX_BENCH_SCOUT_SEQUENCE),
        resolveRouterSearchStrategy(process.env.PIX_BENCH_ROUTER_STRATEGY),
      ),
    )
    expect(artifact.timings.totalDurationMs).toBeGreaterThan(0)
    expect(Object.values(artifact.timings).every((duration) => duration >= 0)).toBe(true)
    expect(
      artifact.evidenceRouterSearch.every(
        ({ searchDiagnostics }) => searchDiagnostics.timings.candidatePoolInitializationMs >= 0,
      ),
    ).toBe(true)
    expect(artifact.embeddingRuns.every((run) => run.queryEmbeddingDurationMs >= 0)).toBe(true)
    expect(artifact.sparseEmbeddingRuns.length).toBe(artifact.repositories.length)
    expect(artifact.sparseEmbeddingRuns.every((run) => run.queryTokenizationDurationMs >= 0)).toBe(
      true,
    )
    expect(artifact.fusionSearch.length).toBe(
      artifact.models.length * fusionMethods * holdoutsPerModel,
    )
    expect(artifact.recommendedFusionWeights.length).toBe(artifact.models.length * fusionMethods)
    expect(artifact.productionRouterSearch.length).toBe(artifact.models.length * holdoutsPerModel)
    expect(artifact.evidenceRouterSearch.length).toBe(
      artifact.models.length * routerFusionMethods * ROUTER_OBJECTIVES.length * holdoutsPerModel,
    )
    expect(new Set(artifact.evidenceRouterSearch.map(({ objective }) => objective))).toEqual(
      new Set(ROUTER_OBJECTIVES),
    )
    expect(new Set(artifact.evidenceRouterSearch.map((row) => row.fusion)).size).toBe(
      routerFusionMethods,
    )
    expect(artifact.recommendedEvidenceRouters.length).toBe(
      artifact.models.length * routerFusionMethods * ROUTER_OBJECTIVES.length,
    )
    expect(artifact.promotionEvidence.length).toBe(
      artifact.models.length * routerFusionMethods * ROUTER_OBJECTIVES.length,
    )
    expect(artifact.evidenceRouterSearch.every((row) => row.proxyEvaluations >= 0)).toBe(true)
    expect(artifact.evidenceRouterSearch.every((row) => row.fullEvaluations > 0)).toBe(true)
    expect(artifact.recommendedEvidenceRouters.every((row) => row.proxyEvaluations >= 0)).toBe(true)
    expect(artifact.recommendedEvidenceRouters.every((row) => row.fullEvaluations > 0)).toBe(true)
    expect(artifact.weightSearch.length).toBe(0)
    expect(artifact.recommendedWeights.length).toBe(0)
    expect(artifact.measurements.every((row) => row.recallAt20 >= row.recallAt10)).toBe(true)
    expect(artifact.measurements.every((row) => row.recallAt10 >= row.recallAt5)).toBe(true)
    expect(artifact.measurements.every((row) => row.recallAt50 >= row.recallAt20)).toBe(true)
    expect(
      artifact.measurements.every(
        (row) =>
          row.ndcgAt5 >= 0 &&
          row.ndcgAt5 <= 1 &&
          row.ndcgAt10 >= 0 &&
          row.ndcgAt10 <= 1 &&
          row.ndcgAt20 >= 0 &&
          row.ndcgAt20 <= 1 &&
          row.ndcgAt50 >= 0 &&
          row.ndcgAt50 <= 1,
      ),
    ).toBe(true)
    expect(outputPath).toMatch(/benchmarks[\\/]results[\\/]retrieval-.*\.json$/)
  })

it.effect.skipIf(!runRetrievalBenchmarks)("runs the smoke retrieval profile", () =>
  runProfile("smoke", 5, 1),
)

it.effect.skipIf(!runRetrievalBenchmarks)("runs the develop retrieval profile", () =>
  runProfile("develop", 3, 1),
)

it.effect.skipIf(!runRetrievalBenchmarks)("runs the validate retrieval profile", () =>
  runProfile("validate", 5, 1),
)

it.effect.skipIf(!runRetrievalBenchmarks)("runs the full retrieval profile", () =>
  runProfile("full", 5, 3),
)

it("shuffles intent groups deterministically before assigning folds", () => {
  const manifests = [
    { id: "first", questions: foldQuestions("first") },
    { id: "second", questions: foldQuestions("second") },
  ]
  const reordered = manifests
    .map((manifest) => ({
      ...manifest,
      questions: [...manifest.questions].reverse(),
    }))
    .reverse()
  const assignments = assignGroupedFolds(manifests, 3)
  const reorderedAssignments = assignGroupedFolds(reordered, 3)
  const sortedEntries = (map: ReadonlyMap<string, number>) =>
    [...map.entries()].sort(([left], [right]) => left.localeCompare(right))

  expect(sortedEntries(assignments)).toEqual(sortedEntries(reorderedAssignments))
  expect([...assignments.values()].sort((left, right) => left - right)).toEqual([
    0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2, 2, 2,
  ])

  expectStratifiedClasses(manifests, assignments)
})

it("resolves the selectable router search strategies", () => {
  expect(resolveRouterSearchStrategy(undefined)).toBe("halving-funnel")
  expect(resolveRouterSearchStrategy("successive-halving")).toBe("successive-halving")
  expect(routerSearchStrategyFor("halton", "successive-halving")).toMatchObject({
    kind: "successive-halving",
    algorithm: "halton-global-scout-elitist-beam-successive-halving",
    halvingKeepFactor: 8,
  })
  expect(resolveRouterSearchStrategy("halving-funnel")).toBe("halving-funnel")
  expect(routerSearchStrategyFor("sobol", "halving-funnel")).toMatchObject({
    kind: "halving-funnel",
    algorithm: "sobol-global-scout-funnel",
    spreadSurvivors: 32,
    finalists: 256,
  })
  const sobolStrategy = routerSearchStrategyFor("sobol", "proxy-promotion")
  expect(sobolStrategy.algorithm).toBe("sobol-global-scout-elitist-beam-proxy-promotion")
  expect(sobolStrategy.kind === "proxy-promotion" && sobolStrategy.proxyPromotionFactor).toBe(8)
  expect(DEFAULT_ROUTER_SEARCH_STRATEGY_PARAMETERS.kind).toBe("proxy-promotion")
  expect(DEFAULT_ROUTER_SEARCH_STRATEGY_PARAMETERS).not.toHaveProperty("halvingKeepFactor")
  expect(() => resolveRouterSearchStrategy("unknown")).toThrow(
    "Unknown PIX_BENCH_ROUTER_STRATEGY value: unknown",
  )
})
