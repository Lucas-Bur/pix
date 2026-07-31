import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"

import { Effect, Option } from "effect"

import { DEFAULT_CONFIG } from "../../src/domain/config.js"
import { MODEL_REGISTRY } from "../../src/domain/models.js"
import type { BoundEmbedder } from "../../src/domain/ports.js"
import { createAutoBoundEmbedder } from "../../src/services/embedder.js"
import { loadCorpusManifests, prepareRepository } from "./corpus.js"
import { loadEmbeddingCache, writeEmbeddingCache } from "./embedding-cache.js"
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
import type { BenchmarkArtifact, CorpusManifest, QueryKind, QueryMeasurement } from "./types.js"
import {
  fitRecommendedEvidenceRouter,
  fitRecommendedWeights,
  optimizeEvidenceRouter,
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

const selectManifests = (manifests: readonly CorpusManifest[]): readonly CorpusManifest[] => {
  const selected = selectValues(process.env.PIX_BENCH_REPOS)
  return selected ? manifests.filter((manifest) => selected.has(manifest.id)) : manifests
}

const selectModels = (): readonly string[] => {
  const selected = selectValues(process.env.PIX_BENCH_MODELS)
  const models = Object.keys(MODEL_REGISTRY).filter((model) => !selected || selected.has(model))
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
export const runRetrievalBenchmark = (): Effect.Effect<
  { readonly artifact: BenchmarkArtifact; readonly outputPath: string },
  Error
> =>
  Effect.gen(function* () {
    const manifests = selectManifests(yield* loadCorpusManifests())
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
          const groupedFold = entry.questionIndex % 5
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

    const weightSearch = [...sampleGroups.values()].flatMap((group) => {
      const groupedFolds = Array.from({ length: 5 }, (_, fold) =>
        optimizeWeights(
          group.model,
          group.queryKind,
          "grouped-5-fold",
          String(fold + 1),
          group.samples.filter((sample) => sample.groupedFold !== fold),
          group.samples.filter((sample) => sample.groupedFold === fold),
        ),
      )
      const repositories = [...new Set(group.samples.map((sample) => sample.repository))]
      const repositoryFolds =
        repositories.length > 1
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
    const recommendedWeights = [...sampleGroups.values()].map((group) =>
      fitRecommendedWeights(group.model, group.queryKind, group.samples),
    )
    const evidenceRouterSearch = [...samplesByModel].flatMap(([model, samples]) => {
      const groupedFolds = Array.from({ length: 5 }, (_, fold) =>
        optimizeEvidenceRouter(
          model,
          "grouped-5-fold",
          String(fold + 1),
          samples.filter((sample) => sample.groupedFold !== fold),
          samples.filter((sample) => sample.groupedFold === fold),
        ),
      )
      const repositories = [...new Set(samples.map((sample) => sample.repository))]
      const repositoryFolds =
        repositories.length > 1
          ? repositories.map((repository) =>
              optimizeEvidenceRouter(
                model,
                "leave-one-repository-out",
                repository,
                samples.filter((sample) => sample.repository !== repository),
                samples.filter((sample) => sample.repository === repository),
              ),
            )
          : []
      return [...groupedFolds, ...repositoryFolds]
    })
    const recommendedEvidenceRouters = [...samplesByModel].map(([model, samples]) =>
      fitRecommendedEvidenceRouter(model, samples),
    )

    const artifact: BenchmarkArtifact = {
      schemaVersion: 4,
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
      evidenceRouterSearch,
      recommendedEvidenceRouters,
    }
    const outputPath = yield* writeArtifact(artifact)
    return { artifact, outputPath }
  })
