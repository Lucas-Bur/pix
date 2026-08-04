import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"

import { Effect, Stream } from "effect"

import type { Embedding } from "../../src/domain/chunk.js"
import { DEFAULT_CONFIG } from "../../src/domain/config.js"
import type { EmbeddingDtype } from "../../src/domain/dtype.js"
import type { StoredChunk } from "../../src/domain/index-data.js"
import { MODEL_REGISTRY } from "../../src/domain/models.js"
import type { BoundEmbedder } from "../../src/domain/ports.js"
import { IndexStore, SparseEmbedder } from "../../src/domain/ports.js"
import { FUSION_METHODS, type FusionMethod } from "../../src/domain/retrieval.js"
import type { SparseContract, SparseTerm, SparseVector } from "../../src/domain/sparse.js"
import { contentHash } from "../../src/lib/content-hash.js"
import { buildQueryTermCoverage } from "../../src/lib/retrieval/evidence-router.js"
import { createAutoBoundEmbedder } from "../../src/services/embedder.js"
import { loadCorpusManifests, prepareRepository } from "./corpus.js"
import { assignGroupedFolds, foldKey } from "./folds.js"
import {
  contextRecallAtBudget,
  goldTargetRanks,
  recallAt,
  reciprocalRank,
  resolveGoldTargets,
  successAt,
} from "./metrics.js"
import { OPTIMIZATION_PROFILES, type OptimizationProfile } from "./optimization-profiles.js"
import { prepareCorpus, type PreparedCorpus } from "./prepare.js"
import { fuseVariant, rankLexicalChannels, RETRIEVAL_VARIANTS } from "./ranking.js"
import { renderMarkdownReport } from "./report.js"
import {
  runEvidenceRouterJobs,
  type EvidenceRouterFitAllJob,
  type EvidenceRouterHoldoutJob,
} from "./router-job-pool.js"
import { withSqliteBenchmarkStore } from "./sqlite-index.js"
import {
  ROUTER_SEARCH_STRATEGY,
  type BenchmarkArtifact,
  type BenchmarkProfile,
  type CorpusManifest,
  type QueryKind,
  type QueryMeasurement,
  type RecommendedEvidenceRouter,
  type ValidationStrategy,
  type EvidenceRouterSearchResult,
} from "./types.js"
import {
  fitRecommendedEvidenceRouterParallel,
  fitRecommendedFusionWeightsParallel,
  fitRecommendedWeightsParallel,
  optimizeEvidenceRouterParallel,
  optimizeFusionWeightsParallel,
  optimizeWeightsParallel,
  evaluateProductionRouter,
  type ParallelSearchOptions,
  type WeightSearchSample,
} from "./weight-search.js"
import {
  createCandidateEvaluationQueue,
  getDefaultWorkerCount,
  resolveWorkerCount,
  type CandidateEvaluationQueue,
} from "./worker-pool.js"

const CONTEXT_BUDGETS = [2_048, 4_096, 8_192, 16_384] as const
const EMBEDDING_BATCH_SIZE = 2
const SINGLE_ITEM_ESTIMATED_TOKENS = 2_048
const QUERY_KINDS: readonly QueryKind[] = [
  "identifier",
  "searchPhrase",
  "naturalQuestion",
  "agentTask",
]

/** Search and validation stages enabled by one benchmark profile. */
interface BenchmarkProfileConfig {
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

const profileConfig = (profile: BenchmarkProfile): BenchmarkProfileConfig => {
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

const reportProgress = (message: string): void => {
  process.stderr.write(`[retrieval benchmark] ${message}\n`)
}

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

const planEvidenceRouterJobs = (
  samplesByModel: ReadonlyMap<string, readonly WeightSearchSample[]>,
  config: BenchmarkProfileConfig,
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

type RouterSearchJobResult =
  | { readonly kind: "holdout"; readonly results: readonly EvidenceRouterSearchResult[] }
  | { readonly kind: "fit-all"; readonly results: readonly RecommendedEvidenceRouter[] }

const runRouterSearchJob = (
  job: EvidenceRouterHoldoutJob | EvidenceRouterFitAllJob,
  profile: OptimizationProfile,
  options: ParallelSearchOptions,
): Promise<RouterSearchJobResult> => {
  if (job.kind === "holdout")
    return optimizeEvidenceRouterParallel(
      job.model,
      job.fusion,
      job.strategy,
      job.fold,
      job.development,
      job.validation,
      profile,
      options,
    ).then((results) => ({ kind: "holdout", results }))
  return fitRecommendedEvidenceRouterParallel(
    job.model,
    job.fusion,
    job.samples,
    profile,
    options,
  ).then((results) => ({ kind: "fit-all", results }))
}

const isLongInput = (text: string): boolean =>
  Buffer.byteLength(text, "utf8") / 4 > SINGLE_ITEM_ESTIMATED_TOKENS

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
  const selected = (OPTIMIZATION_PROFILES as Record<string, OptimizationProfile | undefined>)[
    requested
  ]
  return selected === undefined
    ? Effect.fail(new Error(`Unknown PIX_BENCH_OPTIMIZATION_PROFILE value: ${requested}`))
    : Effect.succeed(selected)
}

const embedTexts = (
  texts: readonly string[],
  model: string,
  embedder: BoundEmbedder,
): Effect.Effect<readonly Float32Array[], Error> =>
  Effect.gen(function* () {
    const vectors: Float32Array[] = []
    let start = 0
    while (start < texts.length) {
      const currentIsLong = isLongInput(texts[start])
      const next = texts[start + 1]
      const nextIsLong = next !== undefined && isLongInput(next)
      const batchSize = currentIsLong || nextIsLong ? 1 : EMBEDDING_BATCH_SIZE
      const batch = texts.slice(start, start + batchSize)
      const embeddings = yield* embedder.batch(batch)
      vectors.push(...embeddings.map((embedding) => embedding.vector))
      start += batchSize
    }
    return vectors
  }).pipe(Effect.mapError((cause) => new Error(`Embedding failed for ${model}`, { cause })))

const embedSparseTexts = (
  texts: readonly string[],
  embedder: typeof SparseEmbedder.Service,
): Effect.Effect<readonly SparseVector[], Error> =>
  Effect.gen(function* () {
    const vectors: SparseVector[] = []
    let start = 0
    while (start < texts.length) {
      const batch = texts.slice(start, start + DEFAULT_CONFIG.sparseEmbedder.batchSize)
      vectors.push(...(yield* embedder.batch(batch)))
      start += DEFAULT_CONFIG.sparseEmbedder.batchSize
    }
    return vectors
  }).pipe(Effect.mapError((cause) => new Error("Sparse document embedding failed", { cause })))

const toStoredChunk = (chunk: PreparedCorpus["chunks"][number]): StoredChunk => {
  const { text, ...location } = chunk
  return { ...location, contentHash: contentHash(text) }
}

const persistBenchmarkCorpus = (
  store: typeof IndexStore.Service,
  corpus: PreparedCorpus,
  vectors: readonly Float32Array[],
  sparseVectors: readonly SparseVector[],
  dims: number,
  dtype: EmbeddingDtype,
  sparseContract: SparseContract,
  sparseIdf: readonly SparseTerm[],
): Effect.Effect<void, Error> =>
  Effect.gen(function* () {
    const pairs = corpus.chunks.map((chunk, index): readonly [StoredChunk, Embedding] => [
      toStoredChunk(chunk),
      { vector: vectors[index]!, dims, dtype },
    ])
    yield* store.persistIndex({
      chunks: Stream.succeed(
        pairs.map(
          ([chunk, embedding], index) => [chunk, embedding, sparseVectors[index]!] as const,
        ),
      ),
      identifierIndex: corpus.identifierIndex,
      bm25Index: corpus.bm25Index,
      files: [],
      dims,
      dtype,
      embeddingCache: [],
      sparseEmbeddingCache: [],
      sparseContract,
      sparseIdf,
    })
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
    const groupedStrategy: ValidationStrategy =
      config.groupedFolds === 3 ? "grouped-3-fold" : "grouped-5-fold"
    const manifests = yield* selectManifests(yield* loadCorpusManifests(), profile)
    const groupedFoldAssignments = assignGroupedFolds(manifests, config.groupedFolds)
    const models = yield* selectModels()
    const repositories: BenchmarkArtifact["repositories"][number][] = []
    const embeddingRuns: BenchmarkArtifact["embeddingRuns"][number][] = []
    const sparseEmbeddingRuns: BenchmarkArtifact["sparseEmbeddingRuns"][number][] = []
    const measurements: QueryMeasurement[] = []
    const sampleGroups = new Map<
      string,
      {
        model: string
        queryKind: QueryKind
        samples: WeightSearchSample[]
      }
    >()
    const samplesByModel = new Map<string, WeightSearchSample[]>()
    let retrievalDurationMs = 0
    let candidateQueueStartupDurationMs = 0
    let candidateQueueShutdownDurationMs = 0

    for (const manifest of manifests) {
      const repositoryPath = yield* prepareRepository(manifest)
      const corpus = yield* prepareCorpus(repositoryPath, manifest)
      repositories.push({
        id: manifest.id,
        repository: manifest.repository,
        revision: manifest.revision,
        chunks: corpus.chunks.length,
        preparationDurationMs: corpus.preparationDurationMs,
      })

      const targetsByQuestion: (readonly ReadonlySet<number>[])[] = []
      for (const question of manifest.questions) {
        const targets = resolveGoldTargets(
          question.groundTruth,
          corpus.chunks,
          corpus.identifiersByChunk,
        )
        const unresolved = question.groundTruth.filter((_, index) => targets[index].size === 0)
        if (unresolved.length > 0)
          return yield* Effect.fail(
            new Error(
              `${question.id} has unresolved gold targets: ${unresolved.map((target) => `${target.file}::${target.symbol}`).join(", ")}`,
            ),
          )
        targetsByQuestion.push(targets)
      }

      const queries = manifest.questions.flatMap((question, questionIndex) =>
        QUERY_KINDS.map((queryKind) => ({
          questionIndex,
          queryKind,
          query: question.queries[queryKind],
        })),
      )
      for (const model of models) {
        const info = MODEL_REGISTRY[model]
        if (info === undefined)
          return yield* Effect.fail(new Error(`Unknown embedding model ${model}`))
        const bound = yield* createAutoBoundEmbedder({
          model,
          dtype: info.defaultDtype,
          dims: info.dims,
        }).pipe(
          Effect.mapError(
            (cause) => new Error(`Could not auto-select a device for ${model}`, { cause }),
          ),
        )
        const embeddingStartedAt = performance.now()
        const chunkVectors = yield* embedTexts(
          corpus.chunks.map((chunk) => chunk.text),
          model,
          bound.embedder,
        )
        const chunkEmbeddingDurationMs = performance.now() - embeddingStartedAt
        const queryEmbeddingStartedAt = performance.now()
        const queryVectors = yield* embedTexts(
          queries.map((entry) => entry.query),
          model,
          bound.embedder,
        )
        embeddingRuns.push({
          repository: manifest.id,
          model,
          device: bound.device,
          batchSize: EMBEDDING_BATCH_SIZE,
          chunkEmbeddingDurationMs,
          queryEmbeddingDurationMs: performance.now() - queryEmbeddingStartedAt,
        })

        const retrievalStartedAt = performance.now()
        const modelRun = yield* withSqliteBenchmarkStore(
          model,
          info.defaultDtype,
          Effect.gen(function* () {
            const store = yield* IndexStore
            const sparseEmbedder = yield* SparseEmbedder
            const sparseStartedAt = performance.now()
            const sparseVectors = yield* embedSparseTexts(
              corpus.chunks.map((chunk) => chunk.text),
              sparseEmbedder,
            )
            const sparseChunkEmbeddingDurationMs = performance.now() - sparseStartedAt
            const sparseIdf = yield* sparseEmbedder.loadIdf()
            const sparseQueryStartedAt = performance.now()
            const sparseQueries = yield* Effect.forEach(queries, ({ query }) =>
              sparseEmbedder.tokenizeQuery(query),
            )
            const sparseQueryTokenizationDurationMs = performance.now() - sparseQueryStartedAt
            yield* persistBenchmarkCorpus(
              store,
              corpus,
              chunkVectors,
              sparseVectors,
              info.dims,
              info.defaultDtype,
              sparseEmbedder.contract,
              sparseIdf,
            )
            sparseEmbeddingRuns.push({
              repository: manifest.id,
              model: sparseEmbedder.contract.model,
              tokenizerModel: sparseEmbedder.contract.tokenizer,
              batchSize: DEFAULT_CONFIG.sparseEmbedder.batchSize,
              chunkEmbeddingDurationMs: sparseChunkEmbeddingDurationMs,
              queryTokenizationDurationMs: sparseQueryTokenizationDurationMs,
            })
            const searchData = yield* store.loadSearchData()
            const modelMeasurements: QueryMeasurement[] = []
            const modelSamples: WeightSearchSample[] = []
            const samplesByQueryKind = new Map<QueryKind, WeightSearchSample[]>()

            for (let queryIndex = 0; queryIndex < queries.length; queryIndex++) {
              const entry = queries[queryIndex]
              const question = manifest.questions[entry.questionIndex]
              const targets = targetsByQuestion[entry.questionIndex]
              const groupedFold = groupedFoldAssignments.get(foldKey(manifest.id, question.id))
              if (groupedFold === undefined)
                return yield* Effect.fail(
                  new Error(`No grouped fold assignment for ${manifest.id}/${question.id}`),
                )
              const channelStartedAt = performance.now()
              const lexicalRankings = rankLexicalChannels(entry.query, searchData)
              const dense = yield* store.searchDense({
                vector: queryVectors[queryIndex]!,
                dims: info.dims,
                dtype: info.defaultDtype,
              })
              const sparse = yield* store.searchSparse(sparseQueries[queryIndex]!)
              const rankings = { ...lexicalRankings, dense, sparse }
              const channelDurationMs = performance.now() - channelStartedAt
              const sample: WeightSearchSample = {
                repository: manifest.id,
                intentId: question.id,
                queryKind: entry.queryKind,
                groupedFold,
                query: entry.query,
                rankings,
                targets,
                chunks: corpus.chunks,
                termCoverage: buildQueryTermCoverage(
                  entry.query,
                  searchData.bm25Index,
                  searchData.identifierIndex,
                ),
              }
              modelSamples.push(sample)
              samplesByQueryKind.set(entry.queryKind, [
                ...(samplesByQueryKind.get(entry.queryKind) ?? []),
                sample,
              ])
              for (const variant of RETRIEVAL_VARIANTS) {
                const variantStartedAt = performance.now()
                const ranked = fuseVariant(variant, entry.query, rankings)
                const queryDurationMs = channelDurationMs + performance.now() - variantStartedAt
                modelMeasurements.push({
                  repository: manifest.id,
                  language: manifest.language,
                  size: manifest.size,
                  revision: manifest.revision,
                  model,
                  variant,
                  questionId: question.id,
                  queryKind: entry.queryKind,
                  query: entry.query,
                  category: question.category,
                  difficulty: question.difficulty,
                  groupedFold,
                  recallAt5: recallAt(ranked, targets, 5),
                  recallAt10: recallAt(ranked, targets, 10),
                  recallAt20: recallAt(ranked, targets, 20),
                  recallAt50: recallAt(ranked, targets, 50),
                  successAt10: successAt(ranked, targets, 10),
                  successAt20: successAt(ranked, targets, 20),
                  reciprocalRank: reciprocalRank(ranked, targets),
                  goldRanks: goldTargetRanks(ranked, targets),
                  contextRecall: Object.fromEntries(
                    CONTEXT_BUDGETS.map((budget) => [
                      String(budget),
                      contextRecallAtBudget(ranked, targets, corpus.chunks, budget),
                    ]),
                  ),
                  queryDurationMs,
                })
              }
            }
            return { measurements: modelMeasurements, samples: modelSamples, samplesByQueryKind }
          }),
        )
        retrievalDurationMs += performance.now() - retrievalStartedAt
        measurements.push(...modelRun.measurements)
        samplesByModel.set(model, [...(samplesByModel.get(model) ?? []), ...modelRun.samples])
        for (const [queryKind, samples] of modelRun.samplesByQueryKind) {
          const groupKey = `${model}\0${queryKind}`
          const group = sampleGroups.get(groupKey) ?? { model, queryKind, samples: [] }
          group.samples.push(...samples)
          sampleGroups.set(groupKey, group)
        }
      }
    }

    const weightSearchStartedAt = performance.now()
    const weightSearch: BenchmarkArtifact["weightSearch"][number][] = []
    const recommendedWeights: BenchmarkArtifact["recommendedWeights"][number][] = []
    if (config.legacyDiagnostics) {
      for (const group of sampleGroups.values()) {
        for (let fold = 0; fold < config.groupedFolds; fold++) {
          const split = splitSamples(group.samples, (sample) => sample.groupedFold === fold)
          weightSearch.push(
            yield* runParallelSearch((signal) =>
              optimizeWeightsParallel(
                group.model,
                group.queryKind,
                groupedStrategy,
                String(fold + 1),
                split.development,
                split.validation,
                optimizationProfile,
                { ...searchOptions, signal },
              ),
            ),
          )
        }
        const repositories = [...new Set(group.samples.map((sample) => sample.repository))]
        if (config.repositoryHoldouts && repositories.length > 1) {
          for (const repository of repositories) {
            const split = splitSamples(group.samples, (sample) => sample.repository === repository)
            weightSearch.push(
              yield* runParallelSearch((signal) =>
                optimizeWeightsParallel(
                  group.model,
                  group.queryKind,
                  "leave-one-repository-out",
                  repository,
                  split.development,
                  split.validation,
                  optimizationProfile,
                  { ...searchOptions, signal },
                ),
              ),
            )
          }
        }
        recommendedWeights.push(
          yield* runParallelSearch((signal) =>
            fitRecommendedWeightsParallel(
              group.model,
              group.queryKind,
              group.samples,
              optimizationProfile,
              { ...searchOptions, signal },
            ),
          ),
        )
      }
    }
    const weightSearchDurationMs = performance.now() - weightSearchStartedAt

    const fusionSearchStartedAt = performance.now()
    const productionRouterSearch: BenchmarkArtifact["productionRouterSearch"][number][] = []
    for (const [model, samples] of samplesByModel) {
      const repositories = [...new Set(samples.map((sample) => sample.repository))]
      for (let fold = 0; fold < config.groupedFolds; fold++) {
        productionRouterSearch.push(
          evaluateProductionRouter(
            model,
            groupedStrategy,
            String(fold + 1),
            samples.filter((sample) => sample.groupedFold !== fold),
            samples.filter((sample) => sample.groupedFold === fold),
            optimizationProfile,
          ),
        )
      }
      if (config.repositoryHoldouts && repositories.length > 1) {
        for (const repository of repositories) {
          productionRouterSearch.push(
            evaluateProductionRouter(
              model,
              "leave-one-repository-out",
              repository,
              samples.filter((sample) => sample.repository !== repository),
              samples.filter((sample) => sample.repository === repository),
              optimizationProfile,
            ),
          )
        }
      }
    }
    const fusionSearch: BenchmarkArtifact["fusionSearch"][number][] = []
    for (const [model, samples] of samplesByModel) {
      const repositories = [...new Set(samples.map((sample) => sample.repository))]
      for (const fusion of config.fusionMethods) {
        reportProgress(`${model}: selecting static ${fusion} fusion weights`)
        for (let fold = 0; fold < config.groupedFolds; fold++) {
          const split = splitSamples(samples, (sample) => sample.groupedFold === fold)
          fusionSearch.push(
            yield* runParallelSearch((signal) =>
              optimizeFusionWeightsParallel(
                model,
                fusion,
                groupedStrategy,
                String(fold + 1),
                split.development,
                split.validation,
                optimizationProfile,
                { ...searchOptions, signal },
              ),
            ),
          )
        }
        if (config.repositoryHoldouts && repositories.length > 1) {
          for (const repository of repositories) {
            const split = splitSamples(samples, (sample) => sample.repository === repository)
            fusionSearch.push(
              yield* runParallelSearch((signal) =>
                optimizeFusionWeightsParallel(
                  model,
                  fusion,
                  "leave-one-repository-out",
                  repository,
                  split.development,
                  split.validation,
                  optimizationProfile,
                  { ...searchOptions, signal },
                ),
              ),
            )
          }
        }
      }
    }
    const recommendedFusionWeights: BenchmarkArtifact["recommendedFusionWeights"][number][] = []
    for (const [model, samples] of samplesByModel)
      for (const fusion of config.fusionMethods)
        recommendedFusionWeights.push(
          yield* runParallelSearch((signal) =>
            fitRecommendedFusionWeightsParallel(model, fusion, samples, optimizationProfile, {
              ...searchOptions,
              signal,
            }),
          ),
        )
    const fusionSearchDurationMs = performance.now() - fusionSearchStartedAt

    const evidenceRouterSearchStartedAt = performance.now()
    const routerJobs = planEvidenceRouterJobs(samplesByModel, config, groupedStrategy)
    const routerWorkerBudget = Math.min(
      resolveWorkerCount(searchOptions.workerCount),
      getDefaultWorkerCount(),
    )
    const recommendedJobs: EvidenceRouterFitAllJob[] = []
    for (const [model, samples] of samplesByModel)
      for (const fusion of config.routerFusionMethods)
        recommendedJobs.push({ kind: "fit-all", model, fusion, samples })
    const allRouterJobs: readonly (EvidenceRouterHoldoutJob | EvidenceRouterFitAllJob)[] = [
      ...routerJobs,
      ...recommendedJobs,
    ]
    const canParallelizeRouterJobs =
      !serialSearch && routerWorkerBudget >= 3 && allRouterJobs.length > 0
    const routerControllerCount = canParallelizeRouterJobs
      ? Math.min(allRouterJobs.length, Math.max(1, Math.floor(routerWorkerBudget / 2)))
      : 0
    const candidateWorkerCount = canParallelizeRouterJobs
      ? Math.max(1, routerWorkerBudget - routerControllerCount)
      : 0
    let candidateQueue: CandidateEvaluationQueue | undefined
    if (canParallelizeRouterJobs) {
      const candidateQueueStartedAt = performance.now()
      candidateQueue = yield* runParallelSearch(() =>
        createCandidateEvaluationQueue({ workerCount: candidateWorkerCount }),
      )
      candidateQueueStartupDurationMs = performance.now() - candidateQueueStartedAt
    }
    reportProgress(
      `running ${allRouterJobs.length} evidence-router jobs with ` +
        `${routerControllerCount} native controllers and ` +
        `${candidateQueue?.workerCount ?? 0} shared candidate workers`,
    )
    const closeCandidateQueue =
      candidateQueue === undefined
        ? Effect.void
        : Effect.gen(function* () {
            const candidateQueueStartedAt = performance.now()
            yield* runParallelSearch(() => candidateQueue!.close())
            candidateQueueShutdownDurationMs = performance.now() - candidateQueueStartedAt
          })
    const routerResults = yield* Effect.ensuring(
      canParallelizeRouterJobs
        ? runParallelSearch((signal) =>
            runEvidenceRouterJobs(allRouterJobs, optimizationProfile, {
              workerCount: routerControllerCount,
              candidateQueue,
              signal,
            }).then((results) =>
              results.map((result): RouterSearchJobResult => {
                if (result.kind === "holdout") return { kind: "holdout", results: result.results }
                return { kind: "fit-all", results: result.results }
              }),
            ),
          )
        : Effect.forEach(
            allRouterJobs,
            (job) =>
              runParallelSearch((signal) =>
                runRouterSearchJob(job, optimizationProfile, {
                  ...searchOptions,
                  workerCount: 0,
                  signal,
                }),
              ),
            { concurrency: 1 },
          ),
      Effect.orDie(closeCandidateQueue),
    )
    let evidenceRouterSearch: readonly EvidenceRouterSearchResult[] = []
    let recommendedEvidenceRouters: readonly RecommendedEvidenceRouter[] = []
    for (const result of routerResults) {
      if (result.kind === "holdout")
        evidenceRouterSearch = [...evidenceRouterSearch, ...result.results]
      else recommendedEvidenceRouters = [...recommendedEvidenceRouters, ...result.results]
    }
    const evidenceRouterSearchDurationMs = performance.now() - evidenceRouterSearchStartedAt

    const embeddingDurationMs = embeddingRuns.reduce(
      (sum, run) => sum + run.chunkEmbeddingDurationMs + run.queryEmbeddingDurationMs,
      0,
    )
    const corpusPreparationDurationMs = repositories.reduce(
      (sum, repository) => sum + repository.preparationDurationMs,
      0,
    )

    const artifact: BenchmarkArtifact = {
      schemaVersion: 23,
      benchmarkProfile: profile,
      optimizationProfile,
      validationProtocol: {
        selection: "development-only",
        holdouts:
          config.repositoryHoldouts && repositories.length > 1
            ? [groupedStrategy, "leave-one-repository-out"]
            : [groupedStrategy],
        finalTest: "nested-cross-validation-plan",
        nestedOuterFolds: config.groupedFolds,
        nestedInnerFolds: Math.max(3, config.groupedFolds - 2),
      },
      generatedAt: new Date().toISOString(),
      searchStrategy: ROUTER_SEARCH_STRATEGY,
      timings: {
        totalDurationMs: performance.now() - benchmarkStartedAt,
        corpusPreparationDurationMs,
        embeddingDurationMs,
        retrievalDurationMs,
        weightSearchDurationMs,
        fusionSearchDurationMs,
        evidenceRouterSearchDurationMs,
        candidateQueueStartupDurationMs,
        candidateQueueShutdownDurationMs,
      },
      chunkConfig: {
        chunkLines: DEFAULT_CONFIG.chunkLines,
        overlapLines: DEFAULT_CONFIG.overlapLines,
        minChunkChars: DEFAULT_CONFIG.minChunkChars,
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
      weightSearch,
      recommendedWeights,
      productionRouterSearch,
      fusionSearch,
      recommendedFusionWeights,
      evidenceRouterSearch,
      recommendedEvidenceRouters,
    }
    const outputPath = yield* writeArtifact(artifact)
    return { artifact, outputPath }
  })
