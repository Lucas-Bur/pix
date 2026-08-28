import { Effect } from "effect"

import { DEFAULT_CONFIG } from "../../../src/domain/config.js"
import type { EmbeddingDtype } from "../../../src/domain/dtype.js"
import type { BoundEmbedder } from "../../../src/domain/ports.js"
import { IndexStore, SparseEmbedder } from "../../../src/domain/ports.js"
import type { EvidenceRouterParameters } from "../../../src/domain/retrieval.js"
import {
  buildQueryTermCoverage,
  buildRoutingEvidence,
  routeWithEvidence,
} from "../../../src/lib/retrieval/evidence-router.js"
import { fuseRankings } from "../../../src/lib/retrieval/fusion.js"
import type { QueryKind } from "../corpus/manifest.js"
import type { CorpusManifest } from "../corpus/manifest.js"
import { prepareCorpus, type PreparedCorpus } from "../corpus/prepare.js"
import { loadCorpusManifests, prepareRepository } from "../corpus/repository.js"
import {
  getDefaultWorkerCount,
  resolveWorkerCount,
} from "../execution/candidate-evaluation-pool.js"
import { withSqliteBenchmarkStore } from "../execution/sqlite-index.js"
import {
  embedSparseTexts,
  embedTexts,
  persistBenchmarkCorpus,
  resolveModelContext,
} from "./collect.js"
import {
  buildSubSampleCorpus,
  planCorpusSizeSubSamples,
  runCorpusSizeSweep,
  type CorpusSizeFit,
  type CorpusSizeSweepRow,
  type CorpusSizeSubSample,
} from "./corpus-size.js"
import { assignGroupedFolds, foldKey } from "./folds.js"
import { normalizedDiscountedCumulativeGain, resolveGoldTargets } from "./metrics.js"
import { OPTIMIZATION_PROFILES } from "./optimization-profiles.js"
import { reportBenchmarkProgress } from "./progress.js"
import { rankLexicalChannels } from "./ranking.js"
import {
  compareRouterModelsAndMethods,
  evaluateRouterComparisonHoldout,
  routeWithComparisonModel,
  type RouterComparisonHoldoutResult,
  type RouterComparisonResult,
} from "./router-search/comparisons.js"
import { SEARCH_CANDIDATE_DEPTH, routerParameters } from "./router-search/config-space.js"
import { runBenchmarkSearch } from "./search.js"
import type { WeightSearchSample } from "./weight-search.js"

const QUERY_FORMS: readonly QueryKind[] = [
  "identifier",
  "searchPhrase",
  "naturalQuestion",
  "agentTask",
]

/** Prepared model, device, and full-size corpus for one repository sweep. */
interface SubSampleContext {
  readonly manifest: CorpusManifest
  readonly model: string
  readonly dims: number
  readonly dtype: EmbeddingDtype
  readonly embedder: BoundEmbedder
  readonly maxTokens: number
  readonly corpus: PreparedCorpus
}

/** Load one model once and prepare the full pinned corpus for sub-sampling. */
const prepareSubSampleContext = (
  repositoryId: string,
  model: string,
): Effect.Effect<SubSampleContext, Error> =>
  Effect.gen(function* () {
    const manifests = yield* loadCorpusManifests()
    const manifest = manifests.find((entry) => entry.id === repositoryId)
    if (manifest === undefined)
      return yield* Effect.fail(new Error(`Unknown benchmark repository ${repositoryId}`))
    const resolved = yield* resolveModelContext(model)
    const repositoryPath = yield* prepareRepository(manifest)
    const corpus = yield* prepareCorpus(repositoryPath, manifest, {
      maxTokens: resolved.maxTokens,
      overlapLines: DEFAULT_CONFIG.overlapLines,
      countTokens: resolved.embedder.countTokens,
      onDiagnostic: () => Effect.void,
    })
    return {
      manifest,
      model,
      dims: resolved.info.dims,
      dtype: resolved.info.defaultDtype,
      embedder: resolved.embedder,
      maxTokens: resolved.maxTokens,
      corpus,
    }
  })

/** Build real weight-search samples for one sub-sample: embeddings, all five channels, gold. */
const buildSubSampleSamples = (
  context: SubSampleContext,
  plan: CorpusSizeSubSample,
): Effect.Effect<readonly WeightSearchSample[], Error> =>
  Effect.gen(function* () {
    const subSample = buildSubSampleCorpus(context.corpus, plan)
    const keptQuestions = context.manifest.questions.filter((question) =>
      plan.keptQuestionIds.includes(question.id),
    )
    const queries = keptQuestions.flatMap((question, questionIndex) =>
      QUERY_FORMS.map((queryKind) => ({
        question,
        questionIndex,
        queryKind,
        query: question.queries[queryKind],
      })),
    )
    const targetsByQuestion = keptQuestions.map((question) =>
      resolveGoldTargets(question.groundTruth, subSample.chunks, subSample.identifiersByChunk),
    )
    const unresolved = keptQuestions.filter((_, index) =>
      targetsByQuestion[index]!.some((targets) => targets.size === 0),
    )
    if (unresolved.length > 0)
      return yield* Effect.fail(
        new Error(
          `Sub-sample ${plan.targetSize} lost gold for: ${unresolved.map((question) => question.id).join(", ")}`,
        ),
      )
    reportBenchmarkProgress(
      `embedding ${subSample.chunks.length} chunks for size ${plan.targetSize}`,
    )
    const chunkVectors = yield* embedTexts(
      subSample.chunks.map((chunk) => chunk.text),
      context.model,
      context.embedder,
    )
    const queryVectors = yield* embedTexts(
      queries.map((entry) => entry.query),
      context.model,
      context.embedder,
    )
    return yield* withSqliteBenchmarkStore(
      context.model,
      context.dtype,
      Effect.gen(function* () {
        const store = yield* IndexStore
        const sparseEmbedder = yield* SparseEmbedder
        const sparseVectors = yield* embedSparseTexts(
          subSample.chunks.map((chunk) => chunk.text),
          sparseEmbedder,
        )
        yield* persistBenchmarkCorpus(
          store,
          {
            chunks: subSample.chunks,
            identifierIndex: subSample.identifierIndex,
            bm25Index: subSample.bm25Index,
          },
          chunkVectors,
          sparseVectors,
          context.dims,
          context.dtype,
          context.maxTokens,
          sparseEmbedder.contract,
          yield* sparseEmbedder.loadIdf,
        )
        const sparseQueries = yield* Effect.forEach(queries, (entry) =>
          sparseEmbedder.tokenizeQuery(entry.query),
        )
        const searchData = yield* store.loadSearchData
        const foldAssignments = assignGroupedFolds([context.manifest], 3)
        const samples: WeightSearchSample[] = []
        for (let queryIndex = 0; queryIndex < queries.length; queryIndex++) {
          const entry = queries[queryIndex]!
          const lexical = rankLexicalChannels(entry.query, searchData)
          const dense = yield* store.searchDense({
            vector: queryVectors[queryIndex]!,
            dims: context.dims,
            dtype: context.dtype,
          })
          const sparse = yield* store.searchSparse(sparseQueries[queryIndex]!)
          samples.push({
            repository: context.manifest.id,
            intentId: entry.question.id,
            queryKind: entry.queryKind,
            groupedFold: foldAssignments.get(foldKey(context.manifest.id, entry.question.id)) ?? 0,
            query: entry.query,
            rankings: { ...lexical, dense, sparse },
            targets: targetsByQuestion[entry.questionIndex]!,
            chunks: subSample.chunks,
            termCoverage: buildQueryTermCoverage(
              entry.query,
              subSample.bm25Index,
              subSample.identifierIndex,
            ),
          })
        }
        return samples
      }),
    )
  })

/** Score one router configuration on real samples with per-query standard error. */
const evaluateRouterConfigOnSamples = (
  samples: readonly WeightSearchSample[],
  config: EvidenceRouterParameters,
  route: (
    evidence: ReturnType<typeof buildRoutingEvidence>,
    config: EvidenceRouterParameters,
  ) => ReturnType<typeof routeWithEvidence> = routeWithEvidence,
): { readonly mean: number; readonly standardError: number } => {
  const values = samples.map((sample) => {
    const evidence = buildRoutingEvidence(sample.query, sample.rankings)
    const weights = route(evidence, config)
    const ranked = fuseRankings("dbsf", sample.rankings, weights, SEARCH_CANDIDATE_DEPTH)
    return normalizedDiscountedCumulativeGain(ranked, sample.targets, 20)
  })
  const mean = values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length)
  const variance =
    values.length < 2
      ? 0
      : values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1)
  return { mean, standardError: Math.sqrt(variance / Math.max(1, values.length)) }
}

/** Parse a comma-separated size list; "full" means the complete corpus. */
const resolveSweepSizes = (requested: string | undefined): readonly number[] => {
  if (requested === undefined) return [200, 500, 1000, Number.POSITIVE_INFINITY]
  return requested.split(",").map((entry) => {
    const trimmed = entry.trim()
    return trimmed === "full" ? Number.POSITIVE_INFINITY : Number(trimmed)
  })
}

/** Real per-size sweep output: sweep rows, fitted model, and sample counts. */
export interface RealCorpusSizeSweepResult {
  readonly rows: readonly CorpusSizeSweepRow[]
  readonly fit: CorpusSizeFit
  readonly perSizeSamples: readonly { readonly corpusSize: number; readonly samples: number }[]
}

const goldTargetsByQuestion = (
  manifest: CorpusManifest,
  corpus: PreparedCorpus,
): { questionId: string; goldChunkIndices: number[] }[] =>
  manifest.questions.map((question) => ({
    questionId: question.id,
    goldChunkIndices: [
      ...new Set(
        resolveGoldTargets(question.groundTruth, corpus.chunks, corpus.identifiersByChunk).flatMap(
          (targets) => [...targets],
        ),
      ),
    ],
  }))

/** Run the real per-size search over sub-sampled corpora and fit the corpus-size model. */
export const runRealCorpusSizeSweep = (
  repositoryId: string,
  model: string,
  sizes: readonly number[] = resolveSweepSizes(process.env.PIX_BENCH_CORPUS_SIZES),
): Effect.Effect<RealCorpusSizeSweepResult, Error> =>
  Effect.gen(function* () {
    const context = yield* prepareSubSampleContext(repositoryId, model)
    const goldByQuestion = goldTargetsByQuestion(context.manifest, context.corpus)
    const plans = planCorpusSizeSubSamples(goldByQuestion, context.corpus.chunks.length, sizes).map(
      (plan) => ({
        ...plan,
        targetSize: Number.isFinite(plan.targetSize)
          ? plan.targetSize
          : context.corpus.chunks.length,
      }),
    )
    const searchOptions = {
      workerCount: Math.min(resolveWorkerCount(), getDefaultWorkerCount()),
      fallbackToSerial: false as const,
    }
    const perSizeSamples: { corpusSize: number; samples: number }[] = []
    const sweep = yield* Effect.promise(() =>
      runCorpusSizeSweep(
        plans,
        async (plan) => {
          const samples = await Effect.runPromise(buildSubSampleSamples(context, plan))
          perSizeSamples.push({ corpusSize: plan.targetSize, samples: samples.length })
          const samplesByModel = new Map<string, readonly WeightSearchSample[]>([
            [context.model, samples],
          ])
          const search = await Effect.runPromise(
            runBenchmarkSearch(
              {
                groupedFolds: 3,
                repositoryHoldouts: false,
                fusionMethods: ["dbsf"],
                routerFusionMethods: ["dbsf"],
              },
              samplesByModel,
              "grouped-3-fold",
              OPTIMIZATION_PROFILES["search-priority"],
              false,
              searchOptions,
            ),
          )
          const router = search.recommendedEvidenceRouters.find(
            (row) => row.fusion === "dbsf" && row.objective === "direct",
          )
          if (router === undefined)
            throw new Error(`No dbsf/direct router recommendation at size ${plan.targetSize}`)
          const scored = evaluateRouterConfigOnSamples(samples, router.config)
          reportBenchmarkProgress(
            `size ${plan.targetSize}: ndcg@20 ${scored.mean.toFixed(4)} ± ${scored.standardError.toFixed(4)}`,
          )
          return [
            {
              coordinate: {
                corpusSize: plan.targetSize,
                fusion: "dbsf",
                profile: "search-priority",
                objective: "direct",
                strategy: "grouped-3-fold",
                fold: "fit-all",
              },
              weights: router.staticWeights,
              score: scored.mean,
              noise: scored.standardError,
            },
          ]
        },
        goldByQuestion,
      ),
    )
    return { ...sweep, perSizeSamples }
  })

/** Real multiplicative vs log-linear comparison output with excluded-holdout scores. */
export interface RealRouterModelComparison {
  readonly results: readonly RouterComparisonResult[]
  readonly holdouts: readonly RouterComparisonHoldoutResult[]
  readonly developmentSamples: number
  readonly validationSamples: number
}

/** Run the real multiplicative-vs-log-linear comparison on one repository's full corpus. */
export const runRealRouterModelComparison = (
  repositoryId: string,
  model: string,
): Effect.Effect<RealRouterModelComparison, Error> =>
  Effect.gen(function* () {
    const context = yield* prepareSubSampleContext(repositoryId, model)
    const goldByQuestion = goldTargetsByQuestion(context.manifest, context.corpus)
    const fullPlan = planCorpusSizeSubSamples(goldByQuestion, context.corpus.chunks.length, [
      Number.POSITIVE_INFINITY,
    ])[0]!
    const samples = yield* buildSubSampleSamples(context, fullPlan)
    const development = samples.filter((sample) => sample.groupedFold !== 0)
    const validation = samples.filter((sample) => sample.groupedFold === 0)
    const results = yield* Effect.promise(() =>
      compareRouterModelsAndMethods({
        seed: OPTIMIZATION_PROFILES["search-priority"].fusionConfig,
        parameters: routerParameters(),
        evidence: development.map((sample) => buildRoutingEvidence(sample.query, sample.rankings)),
        pruneInactive: true,
        evaluateDevelopment: async (routerModel, configs) =>
          configs.map((config) =>
            evaluateRouterConfigOnSamples(development, config, (evidence, candidate) =>
              routeWithComparisonModel(routerModel, evidence, candidate),
            ),
          ),
      }),
    )
    const holdouts = yield* Effect.promise(() =>
      Promise.all(
        results.map((result) =>
          evaluateRouterComparisonHoldout(result, async (configs) =>
            configs.map((config) =>
              evaluateRouterConfigOnSamples(validation, config, (evidence, candidate) =>
                routeWithComparisonModel(result.model, evidence, candidate),
              ),
            ),
          ),
        ),
      ),
    )
    return {
      results,
      holdouts,
      developmentSamples: development.length,
      validationSamples: validation.length,
    }
  })
