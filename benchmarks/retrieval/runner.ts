import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"

import { Effect, Option, Stream } from "effect"

import type { Embedding } from "../../src/domain/chunk.js"
import { DEFAULT_CONFIG } from "../../src/domain/config.js"
import type { EmbeddingDtype } from "../../src/domain/dtype.js"
import type { StoredChunk } from "../../src/domain/index-data.js"
import { MODEL_REGISTRY } from "../../src/domain/models.js"
import type { BoundEmbedder } from "../../src/domain/ports.js"
import { IndexStore } from "../../src/domain/ports.js"
import { contentHash } from "../../src/lib/content-hash.js"
import { createAutoBoundEmbedder } from "../../src/services/embedder.js"
import { loadCorpusManifests, prepareRepository } from "./corpus.js"
import { loadEmbeddingCache, writeEmbeddingCache } from "./embedding-cache.js"
import { buildQueryTermCoverage } from "./evidence-router.js"
import { assignGroupedFolds } from "./folds.js"
import { FUSION_METHODS } from "./fusion.js"
import {
  contextRecallAtBudget,
  goldTargetRanks,
  recallAt,
  reciprocalRank,
  resolveGoldTargets,
  successAt,
} from "./metrics.js"
import { prepareCorpus, type PreparedCorpus } from "./prepare.js"
import { fuseVariant, rankLexicalChannels, RETRIEVAL_VARIANTS } from "./ranking.js"
import { renderMarkdownReport } from "./report.js"
import { withSqliteBenchmarkStore } from "./sqlite-index.js"
import {
  ROUTER_SEARCH_STRATEGY,
  type BenchmarkArtifact,
  type BenchmarkProfile,
  type CorpusManifest,
  type FusionMethod,
  type QueryKind,
  type QueryMeasurement,
  type ValidationStrategy,
} from "./types.js"
import {
  fitRecommendedEvidenceRouter,
  fitRecommendedFusionWeights,
  fitRecommendedWeights,
  optimizeEvidenceRouter,
  optimizeFusionWeights,
  optimizeWeights,
  evaluateProductionRrf,
  type WeightSearchSample,
} from "./weight-search.js"

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
): readonly CorpusManifest[] => {
  const selected = selectValues(process.env.PIX_BENCH_REPOS)
  if (selected) return manifests.filter((manifest) => selected.has(manifest.id))
  return profile === "smoke" ? manifests.filter((manifest) => manifest.id === "fd") : manifests
}

const selectModels = (): readonly string[] => {
  const selected = selectValues(process.env.PIX_BENCH_MODELS)
  if (selected && selected.size !== 1)
    throw new Error("PIX_BENCH_MODELS must select exactly one embedding model")
  const models = Object.keys(MODEL_REGISTRY).filter((model) =>
    selected ? selected.has(model) : model === "Xenova/all-MiniLM-L6-v2",
  )
  if (selected && models.length !== selected.size) {
    const unknown = [...selected].filter((model) => MODEL_REGISTRY[model] === undefined)
    throw new Error(`Unknown PIX_BENCH_MODELS values: ${unknown.join(", ")}`)
  }
  return models
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

const embedCorpus = (
  manifest: CorpusManifest,
  chunks: PreparedCorpus["chunks"],
  model: string,
  device: string,
  embedder: BoundEmbedder,
): Effect.Effect<
  {
    readonly vectors: readonly Float32Array[]
    readonly cacheHit: boolean
    readonly device: string
  },
  Error
> => {
  const info = MODEL_REGISTRY[model]
  if (info === undefined) return Effect.fail(new Error(`Unknown embedding model ${model}`))
  return Effect.gen(function* () {
    const cached = yield* loadEmbeddingCache(
      manifest,
      model,
      device,
      EMBEDDING_BATCH_SIZE,
      info.dims,
      chunks,
    )
    if (Option.isSome(cached)) {
      return { vectors: cached.value, cacheHit: true, device }
    }
    const vectors = yield* embedTexts(
      chunks.map((chunk) => chunk.text),
      model,
      embedder,
    )
    yield* writeEmbeddingCache(
      manifest,
      model,
      device,
      EMBEDDING_BATCH_SIZE,
      info.dims,
      chunks,
      vectors,
    )
    return { vectors, cacheHit: false, device }
  })
}

const toStoredChunk = (chunk: PreparedCorpus["chunks"][number]): StoredChunk => {
  const { text, ...location } = chunk
  return { ...location, contentHash: contentHash(text) }
}

const persistBenchmarkCorpus = (
  store: typeof IndexStore.Service,
  corpus: PreparedCorpus,
  vectors: readonly Float32Array[],
  dims: number,
  dtype: EmbeddingDtype,
): Effect.Effect<void, Error> =>
  Effect.gen(function* () {
    const pairs = corpus.chunks.map((chunk, index): readonly [StoredChunk, Embedding] => [
      toStoredChunk(chunk),
      { vector: vectors[index]!, dims, dtype },
    ])
    yield* store.persistIndex({
      chunks: Stream.succeed(pairs),
      identifierIndex: corpus.identifierIndex,
      bm25Index: corpus.bm25Index,
      files: [],
      dims,
      dtype,
      embeddingCache: [],
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
    const groupedStrategy: ValidationStrategy =
      config.groupedFolds === 3 ? "grouped-3-fold" : "grouped-5-fold"
    const manifests = selectManifests(yield* loadCorpusManifests(), profile)
    const groupedFoldAssignments = assignGroupedFolds(manifests, config.groupedFolds)
    const models = selectModels()
    const repositories: BenchmarkArtifact["repositories"][number][] = []
    const embeddingRuns: BenchmarkArtifact["embeddingRuns"][number][] = []
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

      const targetsByQuestion = manifest.questions.map((question) => {
        const targets = resolveGoldTargets(
          question.groundTruth,
          corpus.chunks,
          corpus.identifiersByChunk,
        )
        const unresolved = question.groundTruth.filter((_, index) => targets[index].size === 0)
        if (unresolved.length > 0) {
          throw new Error(
            `${question.id} has unresolved gold targets: ${unresolved.map((target) => `${target.file}::${target.symbol}`).join(", ")}`,
          )
        }
        return targets
      })

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
        const embedded = yield* embedCorpus(
          manifest,
          corpus.chunks,
          model,
          bound.device,
          bound.embedder,
        )
        const chunkVectors = embedded.vectors
        const chunkEmbeddingDurationMs = performance.now() - embeddingStartedAt
        const queries = manifest.questions.flatMap((question, questionIndex) =>
          QUERY_KINDS.map((queryKind) => ({
            questionIndex,
            queryKind,
            query: question.queries[queryKind],
          })),
        )
        const queryEmbeddingStartedAt = performance.now()
        const queryVectors = yield* embedTexts(
          queries.map((entry) => entry.query),
          model,
          bound.embedder,
        )
        embeddingRuns.push({
          repository: manifest.id,
          model,
          device: embedded.device,
          batchSize: EMBEDDING_BATCH_SIZE,
          chunkEmbeddingDurationMs,
          queryEmbeddingDurationMs: performance.now() - queryEmbeddingStartedAt,
          cacheHit: embedded.cacheHit,
        })

        const retrievalStartedAt = performance.now()
        const modelRun = yield* withSqliteBenchmarkStore(
          model,
          info.defaultDtype,
          Effect.gen(function* () {
            const store = yield* IndexStore
            yield* persistBenchmarkCorpus(store, corpus, chunkVectors, info.dims, info.defaultDtype)
            const searchData = yield* store.loadSearchData()
            const modelMeasurements: QueryMeasurement[] = []
            const modelSamples: WeightSearchSample[] = []
            const samplesByQueryKind = new Map<QueryKind, WeightSearchSample[]>()

            for (let queryIndex = 0; queryIndex < queries.length; queryIndex++) {
              const entry = queries[queryIndex]
              const question = manifest.questions[entry.questionIndex]
              const targets = targetsByQuestion[entry.questionIndex]
              const groupedFold = groupedFoldAssignments.get(`${manifest.id}\0${question.id}`)
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
              const rankings = { ...lexicalRankings, dense }
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
    const weightSearch = config.legacyDiagnostics
      ? [...sampleGroups.values()].flatMap((group) => {
          const groupedFolds = Array.from({ length: config.groupedFolds }, (_, fold) =>
            optimizeWeights(
              group.model,
              group.queryKind,
              groupedStrategy,
              String(fold + 1),
              group.samples.filter((sample) => sample.groupedFold !== fold),
              group.samples.filter((sample) => sample.groupedFold === fold),
            ),
          )
          const repositories = [...new Set(group.samples.map((sample) => sample.repository))]
          const repositoryFolds =
            config.repositoryHoldouts && repositories.length > 1
              ? repositories.map((repository) =>
                  optimizeWeights(
                    group.model,
                    group.queryKind,
                    "leave-one-repository-out",
                    repository,
                    group.samples.filter((sample) => sample.repository !== repository),
                    group.samples.filter((sample) => sample.repository === repository),
                  ),
                )
              : []
          return [...groupedFolds, ...repositoryFolds]
        })
      : []
    const recommendedWeights = config.legacyDiagnostics
      ? [...sampleGroups.values()].map((group) =>
          fitRecommendedWeights(group.model, group.queryKind, group.samples),
        )
      : []
    const weightSearchDurationMs = performance.now() - weightSearchStartedAt

    const fusionSearchStartedAt = performance.now()
    const productionRrfSearch: BenchmarkArtifact["productionRrfSearch"][number][] = []
    for (const [model, samples] of samplesByModel) {
      const repositories = [...new Set(samples.map((sample) => sample.repository))]
      for (let fold = 0; fold < config.groupedFolds; fold++) {
        productionRrfSearch.push(
          evaluateProductionRrf(
            model,
            groupedStrategy,
            String(fold + 1),
            samples.filter((sample) => sample.groupedFold !== fold),
            samples.filter((sample) => sample.groupedFold === fold),
          ),
        )
      }
      if (config.repositoryHoldouts && repositories.length > 1) {
        for (const repository of repositories) {
          productionRrfSearch.push(
            evaluateProductionRrf(
              model,
              "leave-one-repository-out",
              repository,
              samples.filter((sample) => sample.repository !== repository),
              samples.filter((sample) => sample.repository === repository),
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
          fusionSearch.push(
            optimizeFusionWeights(
              model,
              fusion,
              groupedStrategy,
              String(fold + 1),
              samples.filter((sample) => sample.groupedFold !== fold),
              samples.filter((sample) => sample.groupedFold === fold),
            ),
          )
        }
        if (config.repositoryHoldouts && repositories.length > 1) {
          for (const repository of repositories) {
            fusionSearch.push(
              optimizeFusionWeights(
                model,
                fusion,
                "leave-one-repository-out",
                repository,
                samples.filter((sample) => sample.repository !== repository),
                samples.filter((sample) => sample.repository === repository),
              ),
            )
          }
        }
      }
    }
    const recommendedFusionWeights = [...samplesByModel].flatMap(([model, samples]) =>
      config.fusionMethods.map((fusion) => fitRecommendedFusionWeights(model, fusion, samples)),
    )
    const fusionSearchDurationMs = performance.now() - fusionSearchStartedAt

    const evidenceRouterSearchStartedAt = performance.now()
    const evidenceRouterSearch: BenchmarkArtifact["evidenceRouterSearch"][number][] = []
    for (const [model, samples] of samplesByModel) {
      for (const fusion of config.routerFusionMethods) {
        for (let fold = 0; fold < config.groupedFolds; fold++) {
          reportProgress(
            `${model}: selecting ${fusion} evidence router for grouped fold ${fold + 1}/${config.groupedFolds}`,
          )
          evidenceRouterSearch.push(
            ...optimizeEvidenceRouter(
              model,
              fusion,
              groupedStrategy,
              String(fold + 1),
              samples.filter((sample) => sample.groupedFold !== fold),
              samples.filter((sample) => sample.groupedFold === fold),
            ),
          )
        }
        const repositories = [...new Set(samples.map((sample) => sample.repository))]
        if (config.repositoryHoldouts && repositories.length > 1) {
          for (const repository of repositories) {
            reportProgress(
              `${model}: selecting ${fusion} evidence router with ${repository} held out`,
            )
            evidenceRouterSearch.push(
              ...optimizeEvidenceRouter(
                model,
                fusion,
                "leave-one-repository-out",
                repository,
                samples.filter((sample) => sample.repository !== repository),
                samples.filter((sample) => sample.repository === repository),
              ),
            )
          }
        }
      }
    }
    reportProgress("fitting final evidence router on all samples")
    const recommendedEvidenceRouters = [...samplesByModel].flatMap(([model, samples]) =>
      config.routerFusionMethods.flatMap((fusion) =>
        fitRecommendedEvidenceRouter(model, fusion, samples),
      ),
    )
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
      schemaVersion: 16,
      benchmarkProfile: profile,
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
      embeddingRuns,
      measurements,
      weightSearch,
      recommendedWeights,
      productionRrfSearch,
      fusionSearch,
      recommendedFusionWeights,
      evidenceRouterSearch,
      recommendedEvidenceRouters,
    }
    const outputPath = yield* writeArtifact(artifact)
    return { artifact, outputPath }
  })
