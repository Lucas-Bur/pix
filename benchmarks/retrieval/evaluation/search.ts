import { Effect } from "effect"

import type { FusionMethod } from "../../../src/domain/retrieval.js"
import {
  createCandidateEvaluationQueue,
  getDefaultWorkerCount,
  resolveWorkerCount,
  type CandidateEvaluationQueue,
} from "../execution/candidate-evaluation-pool.js"
import type { OptimizationProfile } from "./optimization-profiles.js"
import { reportBenchmarkProgress } from "./progress.js"
import { derivePromotionEvidence } from "./promotion-evidence.js"
import type {
  BenchmarkArtifact,
  EvidenceRouterSearchResult,
  RecommendedEvidenceRouter,
  PromotionStatus,
  ValidationStrategy,
} from "./types.js"
import {
  fitRecommendedEvidenceRouter,
  fitRecommendedFusionWeights,
  fitRecommendedWeights,
  optimizeEvidenceRouter,
  optimizeFusionWeights,
  optimizeWeights,
  evaluateProductionRouter,
  type BenchmarkSearchOptions,
  type WeightSearchSample,
} from "./weight-search.js"

/** Search and validation stages enabled by one benchmark profile. */
export interface BenchmarkSearchConfig {
  /** Number of intent-grouped cross-validation folds. */
  readonly groupedFolds: number
  /** Whether each selected repository is evaluated as an excluded holdout. */
  readonly repositoryHoldouts: boolean
  /** Whether historical query-kind RRF grids and Shapley diagnostics run. */
  readonly legacyDiagnostics: boolean
  /** Static fusion formulas evaluated by this profile. */
  readonly fusionMethods: readonly FusionMethod[]
  /** Fusion formulas used when evaluating the evidence router. */
  readonly routerFusionMethods: readonly FusionMethod[]
}

/** Quality search outputs and timing fields assembled for one benchmark artifact. */
export interface BenchmarkSearchResults {
  readonly weightSearch: readonly BenchmarkArtifact["weightSearch"][number][]
  readonly recommendedWeights: readonly BenchmarkArtifact["recommendedWeights"][number][]
  readonly productionRouterSearch: readonly BenchmarkArtifact["productionRouterSearch"][number][]
  readonly fusionSearch: readonly BenchmarkArtifact["fusionSearch"][number][]
  readonly recommendedFusionWeights: readonly BenchmarkArtifact["recommendedFusionWeights"][number][]
  readonly evidenceRouterSearch: readonly BenchmarkArtifact["evidenceRouterSearch"][number][]
  readonly recommendedEvidenceRouters: readonly BenchmarkArtifact["recommendedEvidenceRouters"][number][]
  readonly promotionEvidence: readonly BenchmarkArtifact["promotionEvidence"][number][]
  readonly weightSearchDurationMs: number
  readonly fusionSearchDurationMs: number
  readonly evidenceRouterSearchDurationMs: number
  readonly candidateQueueStartupDurationMs: number
  readonly candidateQueueShutdownDurationMs: number
}

type SampleGroup = {
  readonly model: string
  readonly queryKind: WeightSearchSample["queryKind"]
  readonly samples: readonly WeightSearchSample[]
}

const describeRouterJob = (job: RouterSearchJob): string =>
  job.kind === "holdout"
    ? `${job.model}/${job.fusion} ${job.strategy} fold ${job.fold}`
    : `${job.model}/${job.fusion} fit-all`

const runParallelSearch = <A>(
  operation: (signal: AbortSignal) => Promise<A>,
): Effect.Effect<A, Error> =>
  Effect.tryPromise({
    try: (signal) => operation(signal),
    catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
  })

const splitSamples = (
  samples: readonly WeightSearchSample[],
  isValidation: (sample: WeightSearchSample) => boolean,
): {
  readonly development: readonly WeightSearchSample[]
  readonly validation: readonly WeightSearchSample[]
} => ({
  development: samples.filter((sample) => !isValidation(sample)),
  validation: samples.filter(isValidation),
})

interface EvidenceRouterHoldoutJob {
  readonly kind: "holdout"
  readonly model: string
  readonly fusion: FusionMethod
  readonly strategy: ValidationStrategy
  readonly fold: string
  readonly development: readonly WeightSearchSample[]
  readonly validation: readonly WeightSearchSample[]
}

interface EvidenceRouterFitAllJob {
  readonly kind: "fit-all"
  readonly model: string
  readonly fusion: FusionMethod
  readonly samples: readonly WeightSearchSample[]
}

const planEvidenceRouterJobs = (
  samplesByModel: ReadonlyMap<string, readonly WeightSearchSample[]>,
  config: BenchmarkSearchConfig,
  groupedStrategy: ValidationStrategy,
): readonly EvidenceRouterHoldoutJob[] => {
  const jobs: EvidenceRouterHoldoutJob[] = []
  for (const [model, samples] of samplesByModel) {
    const repositories = [...new Set(samples.map((sample) => sample.repository))]
    for (const fusion of config.routerFusionMethods) {
      for (let fold = 0; fold < config.groupedFolds; fold++) {
        const split = splitSamples(samples, (sample) => sample.groupedFold === fold)
        jobs.push({
          kind: "holdout",
          model,
          fusion,
          strategy: groupedStrategy,
          fold: String(fold + 1),
          development: split.development,
          validation: split.validation,
        })
      }
      if (config.repositoryHoldouts && repositories.length > 1) {
        for (const repository of repositories) {
          const split = splitSamples(samples, (sample) => sample.repository === repository)
          jobs.push({
            kind: "holdout",
            model,
            fusion,
            strategy: "leave-one-repository-out",
            fold: repository,
            development: split.development,
            validation: split.validation,
          })
        }
      }
    }
  }
  return jobs
}

type RouterSearchJob = EvidenceRouterHoldoutJob | EvidenceRouterFitAllJob
type RouterSearchJobResult =
  | { readonly kind: "holdout"; readonly results: readonly EvidenceRouterSearchResult[] }
  | { readonly kind: "fit-all"; readonly results: readonly RecommendedEvidenceRouter[] }

const runRouterSearchJob = (
  job: RouterSearchJob,
  profile: OptimizationProfile,
  options: BenchmarkSearchOptions,
): Promise<RouterSearchJobResult> => {
  if (job.kind === "holdout")
    return optimizeEvidenceRouter(
      job.model,
      job.fusion,
      job.strategy,
      job.fold,
      job.development,
      job.validation,
      profile,
      options,
    ).then((results) => ({ kind: "holdout", results }))
  return fitRecommendedEvidenceRouter(job.model, job.fusion, job.samples, profile, options).then(
    (results) => ({ kind: "fit-all", results }),
  )
}

interface SearchSplit {
  readonly strategy: ValidationStrategy
  readonly fold: string
  readonly development: readonly WeightSearchSample[]
  readonly validation: readonly WeightSearchSample[]
}

const planSearchSplits = (
  samples: readonly WeightSearchSample[],
  config: BenchmarkSearchConfig,
  groupedStrategy: ValidationStrategy,
): readonly SearchSplit[] => {
  const splits: SearchSplit[] = []
  for (let fold = 0; fold < config.groupedFolds; fold++) {
    const split = splitSamples(samples, (sample) => sample.groupedFold === fold)
    splits.push({
      strategy: groupedStrategy,
      fold: String(fold + 1),
      development: split.development,
      validation: split.validation,
    })
  }
  const repositories = [...new Set(samples.map((sample) => sample.repository))]
  if (config.repositoryHoldouts && repositories.length > 1)
    for (const repository of repositories) {
      const split = splitSamples(samples, (sample) => sample.repository === repository)
      splits.push({
        strategy: "leave-one-repository-out",
        fold: repository,
        development: split.development,
        validation: split.validation,
      })
    }
  return splits
}

interface WeightSearchGroupResult {
  readonly weightSearch: readonly BenchmarkArtifact["weightSearch"][number][]
  readonly recommendedWeights: readonly BenchmarkArtifact["recommendedWeights"][number][]
}

const runWeightSearchForGroup = (
  group: SampleGroup,
  config: BenchmarkSearchConfig,
  groupedStrategy: ValidationStrategy,
  optimizationProfile: OptimizationProfile,
  searchOptions: BenchmarkSearchOptions,
): Effect.Effect<WeightSearchGroupResult, Error> =>
  Effect.gen(function* () {
    const weightSearch: BenchmarkArtifact["weightSearch"][number][] = []
    for (const split of planSearchSplits(group.samples, config, groupedStrategy))
      weightSearch.push(
        yield* runParallelSearch((signal) =>
          optimizeWeights(
            group.model,
            group.queryKind,
            split.strategy,
            split.fold,
            split.development,
            split.validation,
            optimizationProfile,
            { ...searchOptions, signal },
          ),
        ),
      )
    const recommendedWeights = [
      yield* runParallelSearch((signal) =>
        fitRecommendedWeights(group.model, group.queryKind, group.samples, optimizationProfile, {
          ...searchOptions,
          signal,
        }),
      ),
    ]
    return { weightSearch, recommendedWeights }
  })

const runWeightSearchStage = (
  config: BenchmarkSearchConfig,
  sampleGroups: ReadonlyMap<string, SampleGroup>,
  groupedStrategy: ValidationStrategy,
  optimizationProfile: OptimizationProfile,
  searchOptions: BenchmarkSearchOptions,
): Effect.Effect<
  Pick<BenchmarkSearchResults, "weightSearch" | "recommendedWeights" | "weightSearchDurationMs">,
  Error
> =>
  Effect.gen(function* () {
    const startedAt = performance.now()
    const weightSearch: BenchmarkArtifact["weightSearch"][number][] = []
    const recommendedWeights: BenchmarkArtifact["recommendedWeights"][number][] = []
    if (config.legacyDiagnostics)
      for (const group of sampleGroups.values()) {
        const result = yield* runWeightSearchForGroup(
          group,
          config,
          groupedStrategy,
          optimizationProfile,
          searchOptions,
        )
        weightSearch.push(...result.weightSearch)
        recommendedWeights.push(...result.recommendedWeights)
      }
    return {
      weightSearch,
      recommendedWeights,
      weightSearchDurationMs: performance.now() - startedAt,
    }
  })

const runProductionRouterSearch = (
  config: BenchmarkSearchConfig,
  samplesByModel: ReadonlyMap<string, readonly WeightSearchSample[]>,
  groupedStrategy: ValidationStrategy,
  optimizationProfile: OptimizationProfile,
): readonly BenchmarkArtifact["productionRouterSearch"][number][] => {
  const results: BenchmarkArtifact["productionRouterSearch"][number][] = []
  for (const [model, samples] of samplesByModel)
    for (const split of planSearchSplits(samples, config, groupedStrategy))
      results.push(
        evaluateProductionRouter(
          model,
          split.strategy,
          split.fold,
          split.development,
          split.validation,
          optimizationProfile,
        ),
      )
  return results
}

const runStaticFusionSearchForModel = (
  model: string,
  samples: readonly WeightSearchSample[],
  config: BenchmarkSearchConfig,
  groupedStrategy: ValidationStrategy,
  optimizationProfile: OptimizationProfile,
  searchOptions: BenchmarkSearchOptions,
): Effect.Effect<readonly BenchmarkArtifact["fusionSearch"][number][], Error> =>
  Effect.gen(function* () {
    const results: BenchmarkArtifact["fusionSearch"][number][] = []
    for (const fusion of config.fusionMethods) {
      reportBenchmarkProgress(`${model}: selecting static ${fusion} fusion weights`)
      for (const split of planSearchSplits(samples, config, groupedStrategy))
        results.push(
          yield* runParallelSearch((signal) =>
            optimizeFusionWeights(
              model,
              fusion,
              split.strategy,
              split.fold,
              split.development,
              split.validation,
              optimizationProfile,
              { ...searchOptions, signal },
            ),
          ),
        )
    }
    return results
  })

const runRecommendedFusionSearchForModel = (
  model: string,
  samples: readonly WeightSearchSample[],
  config: BenchmarkSearchConfig,
  optimizationProfile: OptimizationProfile,
  searchOptions: BenchmarkSearchOptions,
): Effect.Effect<readonly BenchmarkArtifact["recommendedFusionWeights"][number][], Error> =>
  Effect.gen(function* () {
    const results: BenchmarkArtifact["recommendedFusionWeights"][number][] = []
    for (const fusion of config.fusionMethods)
      results.push(
        yield* runParallelSearch((signal) =>
          fitRecommendedFusionWeights(model, fusion, samples, optimizationProfile, {
            ...searchOptions,
            signal,
          }),
        ),
      )
    return results
  })

const runFusionSearchStage = (
  config: BenchmarkSearchConfig,
  samplesByModel: ReadonlyMap<string, readonly WeightSearchSample[]>,
  groupedStrategy: ValidationStrategy,
  optimizationProfile: OptimizationProfile,
  searchOptions: BenchmarkSearchOptions,
): Effect.Effect<
  Pick<
    BenchmarkSearchResults,
    | "productionRouterSearch"
    | "fusionSearch"
    | "recommendedFusionWeights"
    | "fusionSearchDurationMs"
  >,
  Error
> =>
  Effect.gen(function* () {
    const startedAt = performance.now()
    const productionRouterSearch = runProductionRouterSearch(
      config,
      samplesByModel,
      groupedStrategy,
      optimizationProfile,
    )
    const fusionSearch: BenchmarkArtifact["fusionSearch"][number][] = []
    for (const [model, samples] of samplesByModel)
      fusionSearch.push(
        ...(yield* runStaticFusionSearchForModel(
          model,
          samples,
          config,
          groupedStrategy,
          optimizationProfile,
          searchOptions,
        )),
      )
    const recommendedFusionWeights: BenchmarkArtifact["recommendedFusionWeights"][number][] = []
    for (const [model, samples] of samplesByModel)
      recommendedFusionWeights.push(
        ...(yield* runRecommendedFusionSearchForModel(
          model,
          samples,
          config,
          optimizationProfile,
          searchOptions,
        )),
      )
    const hasRepositoryHoldouts = [...samplesByModel.values()].some(
      (modelSamples) => new Set(modelSamples.map((sample) => sample.repository)).size > 1,
    )
    const expectedStrategies: readonly ValidationStrategy[] =
      config.repositoryHoldouts && hasRepositoryHoldouts
        ? [groupedStrategy, "leave-one-repository-out"]
        : [groupedStrategy]
    const validatedRecommendations = recommendedFusionWeights.map((recommendation) => {
      const holdouts = fusionSearch.filter(
        (row) => row.model === recommendation.model && row.fusion === recommendation.fusion,
      )
      const strategies = new Set(holdouts.map((row) => row.strategy))
      const eligible =
        expectedStrategies.every((strategy) => strategies.has(strategy)) &&
        holdouts.length > 0 &&
        holdouts.every((row) => row.holdoutBreakdown.every((partition) => partition.guardrailsMet))
      const promotionStatus: PromotionStatus = eligible ? "eligible" : "no-eligible-candidate"
      return {
        ...recommendation,
        guardrailsMet: eligible,
        promotionStatus,
      }
    })
    return {
      productionRouterSearch,
      fusionSearch,
      recommendedFusionWeights: validatedRecommendations,
      fusionSearchDurationMs: performance.now() - startedAt,
    }
  })

const runRouterSearchJobs = (
  allRouterJobs: readonly RouterSearchJob[],
  optimizationProfile: OptimizationProfile,
  searchOptions: BenchmarkSearchOptions,
  candidateQueue: CandidateEvaluationQueue | undefined,
  canParallelize: boolean,
): Effect.Effect<readonly RouterSearchJobResult[], Error> => {
  const trackCompletion = (job: RouterSearchJob, result: RouterSearchJobResult) => {
    completed += 1
    reportBenchmarkProgress(
      `router job ${completed}/${allRouterJobs.length} done: ${describeRouterJob(job)}`,
    )
    return result
  }
  let completed = 0
  return canParallelize
    ? runParallelSearch((signal) =>
        Promise.all(
          allRouterJobs.map((job) =>
            runRouterSearchJob(job, optimizationProfile, {
              ...searchOptions,
              workerCount: 0,
              evaluationQueue: candidateQueue,
              signal,
            }).then((result) => trackCompletion(job, result)),
          ),
        ),
      )
    : Effect.forEach(
        allRouterJobs,
        (job) => {
          reportBenchmarkProgress(`router job starting: ${describeRouterJob(job)}`)
          return runParallelSearch((signal) =>
            runRouterSearchJob(job, optimizationProfile, {
              ...searchOptions,
              workerCount: 0,
              signal,
            }).then((result) => trackCompletion(job, result)),
          )
        },
        { concurrency: 1 },
      )
}

const runEvidenceRouterSearchStage = (
  config: BenchmarkSearchConfig,
  samplesByModel: ReadonlyMap<string, readonly WeightSearchSample[]>,
  groupedStrategy: ValidationStrategy,
  optimizationProfile: OptimizationProfile,
  serialSearch: boolean,
  searchOptions: BenchmarkSearchOptions,
): Effect.Effect<
  Pick<
    BenchmarkSearchResults,
    | "evidenceRouterSearch"
    | "recommendedEvidenceRouters"
    | "promotionEvidence"
    | "evidenceRouterSearchDurationMs"
    | "candidateQueueStartupDurationMs"
    | "candidateQueueShutdownDurationMs"
  >,
  Error
> =>
  Effect.gen(function* () {
    const startedAt = performance.now()
    const routerJobs = planEvidenceRouterJobs(samplesByModel, config, groupedStrategy)
    const routerWorkerBudget = Math.min(
      resolveWorkerCount(searchOptions.workerCount),
      getDefaultWorkerCount(),
    )
    const recommendedJobs: EvidenceRouterFitAllJob[] = []
    for (const [model, samples] of samplesByModel)
      for (const fusion of config.routerFusionMethods)
        recommendedJobs.push({ kind: "fit-all", model, fusion, samples })
    const allRouterJobs: readonly RouterSearchJob[] = [...routerJobs, ...recommendedJobs]
    const canParallelize = !serialSearch && routerWorkerBudget >= 2 && allRouterJobs.length > 0
    const candidateWorkerCount = canParallelize ? routerWorkerBudget : 0
    let candidateQueueStartupDurationMs = 0
    let candidateQueueShutdownDurationMs = 0
    let candidateQueue: CandidateEvaluationQueue | undefined
    if (canParallelize) {
      const queueStartedAt = performance.now()
      candidateQueue = yield* runParallelSearch(() =>
        createCandidateEvaluationQueue({ workerCount: candidateWorkerCount }),
      )
      candidateQueueStartupDurationMs = performance.now() - queueStartedAt
    }
    reportBenchmarkProgress(
      `running ${allRouterJobs.length} evidence-router jobs ` +
        `(${routerJobs.length} holdout, ${recommendedJobs.length} fit-all) with ` +
        `${candidateQueue?.workerCount ?? 0} shared candidate workers`,
    )
    const routerResults = yield* Effect.ensuring(
      runRouterSearchJobs(
        allRouterJobs,
        optimizationProfile,
        searchOptions,
        candidateQueue,
        canParallelize,
      ),
      candidateQueue === undefined
        ? Effect.void
        : Effect.orDie(
            Effect.gen(function* () {
              const queueStartedAt = performance.now()
              yield* runParallelSearch(() => candidateQueue!.close())
              candidateQueueShutdownDurationMs = performance.now() - queueStartedAt
            }),
          ),
    )
    const evidenceRouterSearch: EvidenceRouterSearchResult[] = []
    const recommendedEvidenceRouters: RecommendedEvidenceRouter[] = []
    for (const result of routerResults) {
      if (result.kind === "holdout") evidenceRouterSearch.push(...result.results)
      else recommendedEvidenceRouters.push(...result.results)
    }
    const expectedStrategies: readonly ValidationStrategy[] =
      config.repositoryHoldouts &&
      [...samplesByModel.values()].some(
        (samples) => new Set(samples.map((sample) => sample.repository)).size > 1,
      )
        ? [groupedStrategy, "leave-one-repository-out"]
        : [groupedStrategy]
    const promotionEvidence = derivePromotionEvidence(evidenceRouterSearch, expectedStrategies, {
      strategy: groupedStrategy,
      fold: String(config.groupedFolds),
    })
    const validatedRecommendations = recommendedEvidenceRouters.map((recommendation) => {
      const evidence = promotionEvidence.find(
        (row) =>
          row.model === recommendation.model &&
          row.fusion === recommendation.fusion &&
          row.objective === recommendation.objective,
      )
      const promotionStatus = evidence?.promotionStatus ?? "no-eligible-candidate"
      return {
        ...recommendation,
        guardrailsMet: promotionStatus === "eligible",
        promotionStatus,
      }
    })
    return {
      evidenceRouterSearch,
      recommendedEvidenceRouters: validatedRecommendations,
      promotionEvidence,
      evidenceRouterSearchDurationMs: performance.now() - startedAt,
      candidateQueueStartupDurationMs,
      candidateQueueShutdownDurationMs,
    }
  })

/** Run all static and evidence-router quality searches over prepared samples. */
export const runBenchmarkSearch = (
  config: BenchmarkSearchConfig,
  sampleGroups: ReadonlyMap<string, SampleGroup>,
  samplesByModel: ReadonlyMap<string, readonly WeightSearchSample[]>,
  groupedStrategy: ValidationStrategy,
  optimizationProfile: OptimizationProfile,
  serialSearch: boolean,
  searchOptions: BenchmarkSearchOptions,
): Effect.Effect<BenchmarkSearchResults, Error> =>
  Effect.gen(function* () {
    const weight = yield* runWeightSearchStage(
      config,
      sampleGroups,
      groupedStrategy,
      optimizationProfile,
      searchOptions,
    )
    const fusion = yield* runFusionSearchStage(
      config,
      samplesByModel,
      groupedStrategy,
      optimizationProfile,
      searchOptions,
    )
    const evidenceRouter = yield* runEvidenceRouterSearchStage(
      config,
      samplesByModel,
      groupedStrategy,
      optimizationProfile,
      serialSearch,
      searchOptions,
    )
    return { ...weight, ...fusion, ...evidenceRouter }
  })
