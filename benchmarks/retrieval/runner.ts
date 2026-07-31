import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"

import { Effect, Option } from "effect"

import { DEFAULT_CONFIG } from "../../src/domain/config.js"
import { MODEL_REGISTRY } from "../../src/domain/models.js"
import type { BoundEmbedder } from "../../src/domain/ports.js"
import { createAutoBoundEmbedder } from "../../src/services/embedder.js"
import { loadCorpusManifests, prepareRepository } from "./corpus.js"
import { loadEmbeddingCache, writeEmbeddingCache } from "./embedding-cache.js"
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
import { fuseVariant, rankChannels, RETRIEVAL_VARIANTS } from "./ranking.js"
import { renderMarkdownReport } from "./report.js"
import type {
  BenchmarkArtifact,
  BenchmarkProfile,
  CorpusManifest,
  FusionMethod,
  QueryKind,
  QueryMeasurement,
  ValidationStrategy,
} from "./types.js"
import {
  fitRecommendedEvidenceRouter,
  fitRecommendedFusionWeights,
  fitRecommendedWeights,
  optimizeEvidenceRouter,
  optimizeFusionWeights,
  optimizeWeights,
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
        legacyDiagnostics: true,
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
    const config = profileConfig(profile)
    const groupedStrategy: ValidationStrategy =
      config.groupedFolds === 3 ? "grouped-3-fold" : "grouped-5-fold"
    const manifests = selectManifests(yield* loadCorpusManifests(), profile)
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
        embeddingRuns.push({
          repository: manifest.id,
          model,
          device: embedded.device,
          batchSize: EMBEDDING_BATCH_SIZE,
          chunkEmbeddingDurationMs: performance.now() - embeddingStartedAt,
          cacheHit: embedded.cacheHit,
        })
        const queries = manifest.questions.flatMap((question, questionIndex) =>
          QUERY_KINDS.map((queryKind) => ({
            questionIndex,
            queryKind,
            query: question.queries[queryKind],
          })),
        )
        const queryVectors = yield* embedTexts(
          queries.map((entry) => entry.query),
          model,
          bound.embedder,
        )

        for (let queryIndex = 0; queryIndex < queries.length; queryIndex++) {
          const entry = queries[queryIndex]
          const question = manifest.questions[entry.questionIndex]
          const targets = targetsByQuestion[entry.questionIndex]
          const groupedFold = entry.questionIndex % config.groupedFolds
          const channelStartedAt = performance.now()
          const rankings = rankChannels(entry.query, corpus, chunkVectors, queryVectors[queryIndex])
          const channelDurationMs = performance.now() - channelStartedAt
          const groupKey = `${model}\0${entry.queryKind}`
          const group = sampleGroups.get(groupKey) ?? {
            model,
            queryKind: entry.queryKind,
            samples: [],
          }
          const sample: WeightSearchSample = {
            repository: manifest.id,
            intentId: question.id,
            groupedFold,
            query: entry.query,
            rankings,
            targets,
            chunks: corpus.chunks,
          }
          group.samples.push(sample)
          sampleGroups.set(groupKey, group)
          const modelSamples = samplesByModel.get(model) ?? []
          modelSamples.push(sample)
          samplesByModel.set(model, modelSamples)
          for (const variant of RETRIEVAL_VARIANTS) {
            const variantStartedAt = performance.now()
            const ranked = fuseVariant(variant, entry.query, rankings)
            const queryDurationMs = channelDurationMs + performance.now() - variantStartedAt
            measurements.push({
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
      }
    }

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
    const evidenceRouterSearch: BenchmarkArtifact["evidenceRouterSearch"][number][] = []
    for (const [model, samples] of samplesByModel) {
      for (const fusion of config.routerFusionMethods) {
        for (let fold = 0; fold < config.groupedFolds; fold++) {
          reportProgress(
            `${model}: selecting ${fusion} evidence router for grouped fold ${fold + 1}/${config.groupedFolds}`,
          )
          evidenceRouterSearch.push(
            optimizeEvidenceRouter(
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
              optimizeEvidenceRouter(
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
      config.routerFusionMethods.map((fusion) =>
        fitRecommendedEvidenceRouter(model, fusion, samples),
      ),
    )

    const artifact: BenchmarkArtifact = {
      schemaVersion: 9,
      benchmarkProfile: profile,
      generatedAt: new Date().toISOString(),
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
      fusionSearch,
      recommendedFusionWeights,
      evidenceRouterSearch,
      recommendedEvidenceRouters,
    }
    const outputPath = yield* writeArtifact(artifact)
    return { artifact, outputPath }
  })
