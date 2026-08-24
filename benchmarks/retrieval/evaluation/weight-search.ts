import type { Chunk } from "../../../src/domain/chunk.js"
import type { RankedChunk } from "../../../src/domain/ports.js"
import {
  PRODUCTION_COMPATIBILITY_CONFIG,
  type ChannelWeights,
  type EvidenceRouterParameters as EvidenceRouterConfig,
  type FusionMethod,
  type ChannelName,
  type ChannelRankings,
} from "../../../src/domain/retrieval.js"
import {
  buildRoutingEvidence,
  routeWithEvidence,
  type QueryTermCoverage,
  type RoutingEvidence,
} from "../../../src/lib/retrieval/evidence-router.js"
import {
  createCandidateEvaluationPool,
  createCandidateEvaluationPoolOnQueue,
  createEvaluationSnapshot,
  type CandidateEvaluationPool,
  type CandidateEvaluationPoolOptions,
  type CandidateEvaluationQueue,
} from "../execution/candidate-evaluation-pool.js"
import {
  contextRecallAtBudget,
  normalizedDiscountedCumulativeGain,
  recallAt,
  reciprocalRank,
} from "./metrics.js"
import { SEARCH_PRIORITY_PROFILE, type OptimizationProfile } from "./optimization-profiles.js"
import { prepareFusion, type PreparedFusionEvaluator } from "./prepared-fusion.js"
import { buildGuardrailBlockers } from "./promotion-evidence.js"
import {
  CHANNELS,
  RANDOM_SEARCH_SEED,
  SEARCH_BEAM_WIDTH,
  SEARCH_CANDIDATE_DEPTH,
  SEARCH_PASSES,
  SEARCH_PROXY_MINIMUM_SAMPLES,
  SEARCH_PROXY_SAMPLE_FRACTION,
  STATIC_FINE_WEIGHT_LEVELS,
  WEIGHT_LEVELS,
  activeChannelsKey,
  benchmarkRouterConfig,
  emptyRouterConfig,
  normalizeWeights,
  routerParameters,
  weightsKey,
  withWeight,
  type RouterCandidate,
} from "./router-search/config-space.js"
import {
  OBJECTIVE_GUARDRAILS,
  compareObjectiveQuality,
  isWithinGuardrails,
  unweightedProfile,
} from "./router-search/objectives.js"
import {
  PROXY_PROMOTION_MODE,
  beamWidthForRound,
  buildGlobalRouterSeeds,
  buildHypothesisRouterSeeds,
  buildSearchDiagnostics,
  rankRouterCandidates,
  resolveRouterSearchMode,
  selectRandomRouter,
  storeQualityResults,
  type RouterSearchContext,
  type RouterSearchMode,
  type SearchEvaluationStats,
} from "./router-search/rank.js"
import { DEFAULT_SCOUT_SEQUENCE, type ScoutSequenceName } from "./scouts/index.js"
import {
  ROUTER_OBJECTIVES,
  type RouterSearchStrategyName,
  type EvidenceRouterSearchResult,
  type FusionSearchResult,
  type HoldoutQuality,
  type ProductionRouterSearchResult,
  type PromotionStatus,
  type QualitySummary,
  type QueryKind,
  type RecommendedEvidenceRouter,
  type RecommendedFusionWeights,
  type RecommendedWeights,
  type RouterSearchDiagnostics,
  type RouterObjective,
  type SearchBaselineComparison,
  type WeightSearchResult,
} from "./types.js"

/** Precomputed query evidence used for cheap fusion and weight experiments. */
export interface WeightSearchSample {
  readonly repository: string
  readonly intentId: string
  /** Query form used to stratify low-fidelity router evaluations. */
  readonly queryKind: QueryKind
  readonly groupedFold: number
  readonly query: string
  readonly rankings: ChannelRankings
  readonly targets: readonly ReadonlySet<number>[]
  readonly chunks: readonly Chunk[]
  readonly termCoverage?: QueryTermCoverage
}

/** Weight-search sample paired with diagnostics cached once before fine-grained search. */
export interface EvidenceSearchSample {
  readonly sample: WeightSearchSample
  readonly evidence: RoutingEvidence
}

/** Native pool controls plus the cancellation signal owned by the benchmark Effect. */
interface SearchOptions extends CandidateEvaluationPoolOptions {
  readonly signal?: AbortSignal
  /** Shared candidate scheduler used to interleave multiple router searches. */
  readonly evaluationQueue?: CandidateEvaluationQueue
  /** Benchmark-only router search algorithm; defaults to the current proxy promotion mode. */
  readonly routerSearchStrategy?: RouterSearchStrategyName
  /** Benchmark-only global-scout sequence; defaults to Halton. */
  readonly scoutSequence?: ScoutSequenceName
  /** Add hand-authored corner hypothesis seeds to the beam starting points. */
  readonly seedHypotheses?: boolean
  /** Start the coordinate rounds with a wider beam that halves towards the target width. */
  readonly beamSchedule?: "fixed" | "decaying"
}

/** Options for benchmark search APIs without colliding with the product query options type. */
export type BenchmarkSearchOptions = SearchOptions

const preparedFusionCache = new WeakMap<
  WeightSearchSample,
  Map<FusionMethod, PreparedFusionEvaluator>
>()
const candidatePoolInitializationMs = new WeakMap<CandidateEvaluationPool, number>()

const preparedFusionEvaluatorFor = (
  sample: WeightSearchSample,
  fusion: FusionMethod = "rrf",
): PreparedFusionEvaluator => {
  let evaluators = preparedFusionCache.get(sample)
  if (evaluators === undefined) {
    evaluators = new Map()
    preparedFusionCache.set(sample, evaluators)
  }
  let evaluator = evaluators.get(fusion)
  if (evaluator === undefined) {
    evaluator = prepareFusion(fusion, sample.rankings, SEARCH_CANDIDATE_DEPTH)
    evaluators.set(fusion, evaluator)
  }
  return evaluator
}

const fuseWithWeights = (
  sample: WeightSearchSample,
  weights: ChannelWeights,
  fusion: FusionMethod = "rrf",
): readonly RankedChunk[] => preparedFusionEvaluatorFor(sample, fusion).evaluate(weights)

const createEvaluationPoolForSamples = async (
  samples: readonly WeightSearchSample[],
  fusion: FusionMethod,
  profile: OptimizationProfile,
  options: SearchOptions,
): Promise<CandidateEvaluationPool> => {
  const snapshotPreparationStartedAt = performance.now()
  const snapshot = createEvaluationSnapshot(
    samples.map((sample) => ({
      evaluator: preparedFusionEvaluatorFor(sample, fusion),
      targets: sample.targets,
      chunks: sample.chunks,
      sampleWeight: profile.queryFormWeights[sample.queryKind],
    })),
  )
  const pool =
    options.evaluationQueue !== undefined
      ? createCandidateEvaluationPoolOnQueue(snapshot, options.evaluationQueue, options.signal)
      : await createCandidateEvaluationPool(snapshot, options)
  candidatePoolInitializationMs.set(pool, performance.now() - snapshotPreparationStartedAt)
  return pool
}

const summarizeRanked = <T>(
  samples: readonly T[],
  rank: (sample: T) => readonly RankedChunk[],
  targets: (sample: T) => readonly ReadonlySet<number>[],
  chunks: (sample: T) => readonly Chunk[],
  sampleWeight: (sample: T) => number = () => 1,
): QualitySummary => {
  if (samples.length === 0) {
    return {
      recallAt5: 0,
      recallAt10: 0,
      recallAt20: 0,
      recallAt50: 0,
      ndcgAt5: 0,
      ndcgAt10: 0,
      ndcgAt20: 0,
      ndcgAt50: 0,
      contextRecallAt4096: 0,
      meanReciprocalRank: 0,
    }
  }
  let recall5 = 0
  let recall10 = 0
  let recall20 = 0
  let recall50 = 0
  let ndcg5 = 0
  let ndcg10 = 0
  let ndcg20 = 0
  let ndcg50 = 0
  let contextRecall = 0
  let mrr = 0
  let totalWeight = 0
  for (const sample of samples) {
    const weight = sampleWeight(sample)
    if (weight <= 0) continue
    const ranked = rank(sample)
    const sampleTargets = targets(sample)
    recall5 += weight * recallAt(ranked, sampleTargets, 5)
    recall10 += weight * recallAt(ranked, sampleTargets, 10)
    recall20 += weight * recallAt(ranked, sampleTargets, 20)
    recall50 += weight * recallAt(ranked, sampleTargets, 50)
    ndcg5 += weight * normalizedDiscountedCumulativeGain(ranked, sampleTargets, 5)
    ndcg10 += weight * normalizedDiscountedCumulativeGain(ranked, sampleTargets, 10)
    ndcg20 += weight * normalizedDiscountedCumulativeGain(ranked, sampleTargets, 20)
    ndcg50 += weight * normalizedDiscountedCumulativeGain(ranked, sampleTargets, 50)
    contextRecall += weight * contextRecallAtBudget(ranked, sampleTargets, chunks(sample), 4_096)
    mrr += weight * reciprocalRank(ranked, sampleTargets)
    totalWeight += weight
  }
  if (totalWeight === 0) {
    return {
      recallAt5: 0,
      recallAt10: 0,
      recallAt20: 0,
      recallAt50: 0,
      ndcgAt5: 0,
      ndcgAt10: 0,
      ndcgAt20: 0,
      ndcgAt50: 0,
      contextRecallAt4096: 0,
      meanReciprocalRank: 0,
    }
  }
  return {
    recallAt5: recall5 / totalWeight,
    recallAt10: recall10 / totalWeight,
    recallAt20: recall20 / totalWeight,
    recallAt50: recall50 / totalWeight,
    ndcgAt5: ndcg5 / totalWeight,
    ndcgAt10: ndcg10 / totalWeight,
    ndcgAt20: ndcg20 / totalWeight,
    ndcgAt50: ndcg50 / totalWeight,
    contextRecallAt4096: contextRecall / totalWeight,
    meanReciprocalRank: mrr / totalWeight,
  }
}

/** Summarize one prepared benchmark candidate with the canonical quality metrics. */
export const summarize = (
  samples: readonly WeightSearchSample[],
  weights: ChannelWeights,
  fusion: FusionMethod = "rrf",
  profile: OptimizationProfile = SEARCH_PRIORITY_PROFILE,
): QualitySummary =>
  summarizeRanked(
    samples,
    (sample) => fuseWithWeights(sample, weights, fusion),
    (sample) => sample.targets,
    (sample) => sample.chunks,
    (sample) => profile.queryFormWeights[sample.queryKind],
  )

const summarizeEvidenceRouter = (
  samples: readonly EvidenceSearchSample[],
  config: EvidenceRouterConfig,
  fusion: FusionMethod,
  profile: OptimizationProfile = SEARCH_PRIORITY_PROFILE,
): QualitySummary =>
  summarizeRanked(
    samples,
    ({ sample, evidence }) => fuseWithWeights(sample, routeWithEvidence(evidence, config), fusion),
    ({ sample }) => sample.targets,
    ({ sample }) => sample.chunks,
    ({ sample }) => profile.queryFormWeights[sample.queryKind],
  )

/** Evaluate the current production router without fitting any benchmark weights. */
const summarizeProductionRouter = (
  samples: readonly WeightSearchSample[],
  profile: OptimizationProfile = SEARCH_PRIORITY_PROFILE,
): QualitySummary =>
  summarizeRanked(
    samples,
    (sample) =>
      fuseWithWeights(
        sample,
        routeWithEvidence(
          buildRoutingEvidence(sample.query, sample.rankings, sample.termCoverage),
          PRODUCTION_COMPATIBILITY_CONFIG,
        ),
        PRODUCTION_COMPATIBILITY_CONFIG.fusion,
      ),
    (sample) => sample.targets,
    (sample) => sample.chunks,
    (sample) => profile.queryFormWeights[sample.queryKind],
  )

interface GuardrailBaselinePartition {
  readonly dimension: HoldoutQuality["dimension"]
  readonly name: string
  readonly samples: readonly WeightSearchSample[]
  readonly baseline: QualitySummary
}

interface GuardrailBaselines {
  readonly overall: QualitySummary
  readonly partitions: readonly GuardrailBaselinePartition[]
}

const prepareEvidenceSamples = (
  samples: readonly WeightSearchSample[],
): readonly EvidenceSearchSample[] =>
  samples.map((sample) => ({
    sample,
    evidence: buildRoutingEvidence(sample.query, sample.rankings, sample.termCoverage),
  }))

const evidenceRouterGuardrailsMet = (
  samples: readonly WeightSearchSample[],
  config: EvidenceRouterConfig,
  fusion: FusionMethod,
  baselines: GuardrailBaselines,
  profile: OptimizationProfile,
  objective: RouterObjective,
): boolean => {
  const holdoutProfile = unweightedProfile(profile)
  const evaluate = (partition: GuardrailBaselinePartition): boolean => {
    const candidate = summarizeEvidenceRouter(
      prepareEvidenceSamples(partition.samples),
      config,
      fusion,
      holdoutProfile,
    )
    return isWithinGuardrails(candidate, partition.baseline, holdoutProfile, objective)
  }
  return (
    isWithinGuardrails(
      summarizeEvidenceRouter(prepareEvidenceSamples(samples), config, fusion, profile),
      baselines.overall,
      profile,
      objective,
    ) && baselines.partitions.every(evaluate)
  )
}

const fusionGuardrailsMet = (
  samples: readonly WeightSearchSample[],
  weights: ChannelWeights,
  fusion: FusionMethod,
  baselines: GuardrailBaselines,
  profile: OptimizationProfile,
): boolean => {
  const holdoutProfile = unweightedProfile(profile)
  const evaluate = (partition: GuardrailBaselinePartition): boolean =>
    isWithinGuardrails(
      summarize(partition.samples, weights, fusion, holdoutProfile),
      partition.baseline,
      holdoutProfile,
    )
  return (
    isWithinGuardrails(summarize(samples, weights, fusion, profile), baselines.overall, profile) &&
    baselines.partitions.every(evaluate)
  )
}

const buildProxySamples = (
  samples: readonly EvidenceSearchSample[],
): readonly EvidenceSearchSample[] => {
  const target = Math.max(
    SEARCH_PROXY_MINIMUM_SAMPLES,
    Math.ceil(samples.length * SEARCH_PROXY_SAMPLE_FRACTION),
  )
  if (target >= samples.length) return samples

  const groups = new Map<string, EvidenceSearchSample[]>()
  for (const sample of samples) {
    const key = `${sample.sample.repository}\0${sample.sample.queryKind}`
    groups.set(key, [...(groups.get(key) ?? []), sample])
  }
  const groupedSamples = [...groups.values()]
  return groupedSamples
    .flatMap((group, groupIndex) =>
      group.map((sample, sampleIndex) => ({
        sample,
        order: sampleIndex * groupedSamples.length + groupIndex,
      })),
    )
    .sort((left, right) => left.order - right.order)
    .slice(0, target)
    .map(({ sample }) => sample)
}

type GuardrailDimension = Exclude<HoldoutQuality["dimension"], "aggregate">

interface GuardrailPartition {
  readonly dimension: GuardrailDimension
  readonly name: string
  readonly samples: readonly WeightSearchSample[]
}

const guardrailPartitions = (
  samples: readonly WeightSearchSample[],
): readonly GuardrailPartition[] => {
  const partitions = new Map<GuardrailDimension, Map<string, WeightSearchSample[]>>()
  for (const sample of samples) {
    const groups: readonly { readonly dimension: GuardrailDimension; readonly name: string }[] = [
      { dimension: "query-form", name: sample.queryKind },
      { dimension: "repository", name: sample.repository },
    ]
    for (const group of groups) {
      const namedPartitions =
        partitions.get(group.dimension) ?? new Map<string, WeightSearchSample[]>()
      const partition = namedPartitions.get(group.name) ?? []
      partition.push(sample)
      namedPartitions.set(group.name, partition)
      partitions.set(group.dimension, namedPartitions)
    }
  }
  return [...partitions].flatMap(([dimension, namedPartitions]) =>
    [...namedPartitions].map(([name, partition]) => ({ dimension, name, samples: partition })),
  )
}

const buildGuardrailBaselines = (
  samples: readonly WeightSearchSample[],
  profile: OptimizationProfile,
): GuardrailBaselines => {
  const holdoutProfile = unweightedProfile(profile)
  return {
    overall: summarizeProductionRouter(samples, profile),
    partitions: guardrailPartitions(samples).map((partition) => ({
      ...partition,
      baseline: summarizeProductionRouter(partition.samples, holdoutProfile),
    })),
  }
}

const buildHoldoutBreakdown = (
  samples: readonly WeightSearchSample[],
  candidate: (
    samples: readonly WeightSearchSample[],
    evaluationProfile: OptimizationProfile,
  ) => QualitySummary,
  profile: OptimizationProfile,
  objective?: RouterObjective,
): readonly HoldoutQuality[] => {
  const holdoutProfile = unweightedProfile(profile)
  const baselines = buildGuardrailBaselines(samples, profile)
  const partitions: readonly GuardrailBaselinePartition[] = [
    { dimension: "aggregate", name: "all", samples, baseline: baselines.overall },
    ...baselines.partitions,
  ]
  return partitions.map((partition) => {
    const evaluationProfile = partition.dimension === "aggregate" ? profile : holdoutProfile
    const candidateQuality = candidate(partition.samples, evaluationProfile)
    const blockers = buildGuardrailBlockers(
      partition.dimension,
      partition.name,
      candidateQuality,
      partition.baseline,
      objective === undefined
        ? evaluationProfile.metricObjective.guardrailMetrics
        : OBJECTIVE_GUARDRAILS[objective],
      evaluationProfile.metricObjective.guardrailTolerance,
    )
    return {
      dimension: partition.dimension,
      name: partition.name,
      queries: partition.samples.length,
      candidate: candidateQuality,
      baseline: partition.baseline,
      guardrailsMet: blockers.length === 0,
      blockers,
    }
  })
}

/** Compare two quality summaries using one benchmark objective's deterministic priority. */
const weightCandidates = (): readonly ChannelWeights[] => {
  const candidates: ChannelWeights[] = []
  for (const identity of WEIGHT_LEVELS)
    for (const camelcase of WEIGHT_LEVELS)
      for (const bm25 of WEIGHT_LEVELS)
        for (const dense of WEIGHT_LEVELS)
          for (const sparse of WEIGHT_LEVELS) {
            if (identity + camelcase + bm25 + dense + sparse === 0) continue
            const max = Math.max(identity, camelcase, bm25, dense, sparse)
            candidates.push({
              identity: identity / max,
              camelcase: camelcase / max,
              bm25: bm25 / max,
              dense: dense / max,
              sparse: sparse / max,
            })
          }
  return [
    ...new Map(
      candidates.map((weights) => [
        CHANNELS.map((channel) => weights[channel].toFixed(2)).join(":"),
        weights,
      ]),
    ).values(),
  ]
}

const factorial = (value: number): number => {
  let result = 1
  for (let factor = 2; factor <= value; factor++) result *= factor
  return result
}

const shapleyValues = (
  samples: readonly WeightSearchSample[],
  weights: ChannelWeights,
  profile: OptimizationProfile = SEARCH_PRIORITY_PROFILE,
): ChannelWeights => {
  const values: Record<ChannelName, number> = {
    identity: 0,
    camelcase: 0,
    bm25: 0,
    dense: 0,
    sparse: 0,
  }
  const channelCount = CHANNELS.length
  const utility = (mask: number): number => {
    if (mask === 0) return 0
    const coalition: ChannelWeights = {
      identity: mask & 1 ? weights.identity : 0,
      camelcase: mask & 2 ? weights.camelcase : 0,
      bm25: mask & 4 ? weights.bm25 : 0,
      dense: mask & 8 ? weights.dense : 0,
      sparse: mask & 16 ? weights.sparse : 0,
    }
    return summarize(samples, coalition, "rrf", profile).recallAt20
  }

  for (let channelIndex = 0; channelIndex < channelCount; channelIndex++) {
    const channelMask = 1 << channelIndex
    for (let mask = 0; mask < 1 << channelCount; mask++) {
      if (mask & channelMask) continue
      const coalitionSize = CHANNELS.filter((_, index) => mask & (1 << index)).length
      const coefficient =
        (factorial(coalitionSize) * factorial(channelCount - coalitionSize - 1)) /
        factorial(channelCount)
      values[CHANNELS[channelIndex]] += coefficient * (utility(mask | channelMask) - utility(mask))
    }
  }
  return values
}

/** Static weight candidate and its development quality. */
export interface WeightCandidate {
  readonly weights: ChannelWeights
  readonly quality: QualitySummary
}

const uniqueWeightCandidates = (
  candidates: readonly ChannelWeights[],
): readonly (readonly [string, ChannelWeights])[] => {
  const unique = new Map<string, ChannelWeights>()
  for (const candidate of candidates) {
    const normalized = normalizeWeights(candidate)
    unique.set(weightsKey(normalized), normalized)
  }
  return [...unique]
}

const sortWeightCandidates = (
  entries: readonly (readonly [string, ChannelWeights])[],
  qualityCache: Map<string, QualitySummary>,
  limit: number,
  objective: RouterObjective,
  baseline: QualitySummary | undefined,
  profile: OptimizationProfile,
  mode: RouterSearchMode,
): readonly WeightCandidate[] =>
  entries
    .map(([key, weights]) => {
      const quality = qualityCache.get(key)
      if (quality === undefined) throw new Error(`Missing cached quality for ${key}`)
      return { weights, quality }
    })
    .sort((left, right) => mode.compareStatic(left, right, objective, baseline, profile))
    .slice(0, limit)

const rankWeightCandidates = async (
  candidates: readonly ChannelWeights[],
  limit: number,
  qualityCache: Map<string, QualitySummary>,
  pool: CandidateEvaluationPool,
  mode: RouterSearchMode,
  objective: RouterObjective = "reranker-top20",
  baseline?: QualitySummary,
  profile: OptimizationProfile = SEARCH_PRIORITY_PROFILE,
): Promise<readonly WeightCandidate[]> => {
  const unique = uniqueWeightCandidates(candidates)
  const pending = unique.filter(([key]) => qualityCache.get(key) === undefined)
  const qualities = await pool.evaluate(pending.map(([, weights]) => ({ weights })))
  storeQualityResults(
    pending,
    qualities,
    qualityCache,
    "Candidate evaluation returned an incomplete weight result",
  )
  return sortWeightCandidates(unique, qualityCache, limit, objective, baseline, profile, mode)
}

const coordinateWeightCandidates = (
  beam: readonly WeightCandidate[],
  channel: ChannelName,
): readonly ChannelWeights[] => [
  // Retain current elites so a later coordinate cannot regress the best development fit.
  ...beam.map((candidate) => candidate.weights),
  ...beam.flatMap((candidate) =>
    STATIC_FINE_WEIGHT_LEVELS.map((level) => withWeight(candidate.weights, channel, level)),
  ),
]

const selectBestWeights = async (
  pool: CandidateEvaluationPool,
  mode: RouterSearchMode,
  objective: RouterObjective = "reranker-top20",
  baseline?: QualitySummary,
  profile: OptimizationProfile = SEARCH_PRIORITY_PROFILE,
): Promise<{ readonly weights: ChannelWeights; readonly quality: QualitySummary }> => {
  const qualityCache = new Map<string, QualitySummary>()
  let beam = await rankWeightCandidates(
    weightCandidates(),
    SEARCH_BEAM_WIDTH,
    qualityCache,
    pool,
    mode,
    objective,
    baseline,
    profile,
  )
  for (let pass = 0; pass < SEARCH_PASSES; pass++) {
    for (const channel of CHANNELS) {
      beam = await rankWeightCandidates(
        coordinateWeightCandidates(beam, channel),
        SEARCH_BEAM_WIDTH,
        qualityCache,
        pool,
        mode,
        objective,
        baseline,
        profile,
      )
    }
  }
  return beam[0]
}

const selectWeightSubsetCandidates = (
  candidates: readonly ChannelWeights[],
  qualities: readonly QualitySummary[],
  profile: OptimizationProfile,
  mode: RouterSearchMode,
): readonly ChannelWeights[] => {
  const selected = new Map<
    string,
    { readonly weights: ChannelWeights; readonly quality: QualitySummary }
  >()
  for (let index = 0; index < candidates.length; index++) {
    const weights = candidates[index]
    const quality = qualities[index]
    if (weights === undefined || quality === undefined)
      throw new Error("Weight subset search returned an incomplete result")
    const key = activeChannelsKey(weights)
    const current = selected.get(key)
    if (
      current === undefined ||
      mode.compareStatic({ weights, quality }, current, "reranker-top20", undefined, profile) < 0
    )
      selected.set(key, { weights, quality })
  }
  return [...selected.values()].map((entry) => entry.weights)
}

const selectBestWeightsPerSubset = async (
  pool: CandidateEvaluationPool,
  profile: OptimizationProfile = SEARCH_PRIORITY_PROFILE,
  mode: RouterSearchMode,
): Promise<readonly ChannelWeights[]> => {
  const candidates = weightCandidates()
  const qualities = await pool.evaluate(candidates.map((weights) => ({ weights })))
  return selectWeightSubsetCandidates(candidates, qualities, profile, mode)
}

const selectStaticWeights = (
  pool: CandidateEvaluationPool,
  mode: RouterSearchMode,
  objective: RouterObjective,
  productionQuality: QualitySummary,
  profile: OptimizationProfile,
) => selectBestWeights(pool, mode, objective, productionQuality, profile)

interface EvidenceRouterSelection {
  readonly objective: RouterObjective
  readonly config: EvidenceRouterConfig
  readonly quality: QualitySummary
  readonly guardrailsMet: boolean
  readonly promotionStatus: PromotionStatus
}

/** Keep a failed guardrail decision explicit instead of treating a fallback as promotable. */
export const selectEligibleCandidate = <T>(
  candidates: readonly T[],
  isEligible: (candidate: T) => boolean,
): { readonly candidate: T | undefined; readonly promotionStatus: PromotionStatus } => {
  const candidate = candidates.find(isEligible)
  return {
    candidate,
    promotionStatus: candidate === undefined ? "no-eligible-candidate" : "eligible",
  }
}

/** Select one eligible archive candidate per objective using that objective's own comparator. */
export const selectObjectiveArchiveCandidates = <T>(
  candidates: readonly T[],
  quality: (candidate: T) => QualitySummary,
  isEligible: (candidate: T, objective: RouterObjective) => boolean,
  baseline: QualitySummary,
  profile: OptimizationProfile = SEARCH_PRIORITY_PROFILE,
): ReadonlyArray<{
  readonly objective: RouterObjective
  readonly candidate: T | undefined
  readonly promotionStatus: PromotionStatus
}> =>
  ROUTER_OBJECTIVES.map((objective) => {
    const ranked = [...candidates].sort((left, right) =>
      compareObjectiveQuality(quality(left), quality(right), objective, baseline, profile),
    )
    const selected = selectEligibleCandidate(ranked, (candidate) =>
      isEligible(candidate, objective),
    )
    return {
      objective,
      candidate: selected.candidate ?? ranked[0],
      promotionStatus: selected.promotionStatus,
    }
  })

interface RouterSearchPreparation {
  readonly samples: readonly WeightSearchSample[]
  readonly evidenceSamples: readonly EvidenceSearchSample[]
  readonly proxySamples: readonly EvidenceSearchSample[]
  readonly guardrailBaselines: GuardrailBaselines
  readonly productionQuality: QualitySummary
  readonly proxyBaseline: QualitySummary
  readonly stats: SearchEvaluationStats
}

const prepareRouterSearch = (
  samples: readonly WeightSearchSample[],
  profile: OptimizationProfile,
): RouterSearchPreparation => {
  const preparationStartedAt = performance.now()
  const evidenceSamples = prepareEvidenceSamples(samples)
  const proxySamples = buildProxySamples(evidenceSamples)
  const guardrailBaselines = buildGuardrailBaselines(samples, profile)
  const proxyBaselines = buildGuardrailBaselines(
    proxySamples.map(({ sample }) => sample),
    profile,
  )
  return {
    samples,
    evidenceSamples,
    proxySamples,
    guardrailBaselines,
    productionQuality: guardrailBaselines.overall,
    proxyBaseline: proxyBaselines.overall,
    stats: {
      rawCandidates: 0,
      uniqueCandidates: 0,
      proxyEvaluations: 0,
      fullEvaluations: 0,
      proxyCacheHits: 0,
      fullCacheHits: 0,
      proxyPromotions: 0,
      proxyAgreementMatches: 0,
      proxyAgreementComparisons: 0,
      protectedEliteCount: 0,
      timings: {
        preparationMs: performance.now() - preparationStartedAt,
        candidatePoolInitializationMs: 0,
        baseWeightSearchMs: 0,
        randomSearchMs: 0,
        beamSearchMs: 0,
        candidatePreparationMs: 0,
        candidateEvaluationMs: 0,
        candidateSelectionMs: 0,
      },
    },
  }
}

const profileSeedFor = (profile: OptimizationProfile): EvidenceRouterConfig => ({
  baseWeights: profile.fusionConfig.baseWeights,
  scoreInfluence: profile.fusionConfig.scoreInfluence,
  geometryInfluence: profile.fusionConfig.geometryInfluence,
  termCoverageInfluence: profile.fusionConfig.termCoverageInfluence,
  pairwiseAgreementInfluence: profile.fusionConfig.pairwiseAgreementInfluence,
  denseConfidenceInfluence: profile.fusionConfig.denseConfidenceInfluence,
  identifierInfluence: profile.fusionConfig.identifierInfluence,
  queryLengthInfluence: profile.fusionConfig.queryLengthInfluence,
})

const selectBestEvidenceRouter = async (
  preparation: RouterSearchPreparation,
  fusion: FusionMethod,
  profile: OptimizationProfile,
  fullPool: CandidateEvaluationPool,
  proxyPool: CandidateEvaluationPool,
  mode: RouterSearchMode,
  scoutSequence: ScoutSequenceName,
  seedHypotheses: boolean = false,
  beamSchedule: "fixed" | "decaying" = "fixed",
): Promise<{
  readonly selections: readonly EvidenceRouterSelection[]
  readonly productionQuality: QualitySummary
  readonly proxyEvaluations: number
  readonly fullEvaluations: number
  readonly searchDiagnostics: RouterSearchDiagnostics
  readonly randomCandidate: RouterCandidate
  readonly randomCandidates: number
}> => {
  const {
    samples,
    evidenceSamples,
    proxySamples,
    guardrailBaselines,
    productionQuality,
    proxyBaseline,
    stats,
  } = preparation
  const searchContext: RouterSearchContext = {
    mode,
    samples: evidenceSamples,
    proxySamples,
    qualityCache: new Map<string, QualitySummary>(),
    proxyQualityCache: new Map<string, QualitySummary>(),
    elites: new Map<string, RouterCandidate>(),
    archive: new Map<string, RouterCandidate>(),
    baseline: productionQuality,
    proxyBaseline,
    fusion,
    profile,
    stats,
    fullPool,
    proxyPool,
  }
  const profileSeed = profileSeedFor(profile)
  const baseSearchStartedAt = performance.now()
  const baseWeights = await selectBestWeights(
    fullPool,
    mode,
    "reranker-top20",
    productionQuality,
    profile,
  )
  const subsetWeights = await selectBestWeightsPerSubset(fullPool, profile, mode)
  const baseSeeds = [baseWeights.weights, ...subsetWeights].map(emptyRouterConfig)
  if (mode.includesProfileSeed) baseSeeds.unshift(profileSeed)
  stats.timings.baseWeightSearchMs += performance.now() - baseSearchStartedAt
  const parameters = routerParameters()
  const randomBaseSeed = baseSeeds[0]
  if (randomBaseSeed === undefined) throw new Error("Evidence router search has no base seed")
  const randomSearch = mode.runsRandomBaseline
    ? await (async () => {
        const randomSearchStartedAt = performance.now()
        const result = await selectRandomRouter(
          evidenceSamples,
          randomBaseSeed,
          parameters,
          fullPool,
          productionQuality,
          profile,
          stats,
        )
        stats.timings.randomSearchMs += performance.now() - randomSearchStartedAt
        return result
      })()
    : undefined
  const beamSearchStartedAt = performance.now()
  const seedConfigs = [
    ...baseSeeds,
    ...buildGlobalRouterSeeds(baseSeeds, parameters, scoutSequence),
    ...(seedHypotheses ? buildHypothesisRouterSeeds(baseSeeds, parameters) : []),
  ]
  const totalRounds = SEARCH_PASSES + 1
  const roundWidth = (round: number): number =>
    beamSchedule === "decaying"
      ? beamWidthForRound(round, totalRounds, SEARCH_BEAM_WIDTH)
      : SEARCH_BEAM_WIDTH
  let beam = await rankRouterCandidates(searchContext, seedConfigs, roundWidth(0), baseSeeds)
  for (let pass = 0; pass < SEARCH_PASSES; pass++) {
    const orderedParameters = pass % 2 === 0 ? parameters : [...parameters].reverse()
    for (const parameter of orderedParameters) {
      beam = await rankRouterCandidates(
        searchContext,
        [
          // Retain the current beam; the search context also protects full-quality elites.
          ...beam.map((candidate) => candidate.config),
          ...beam.flatMap((candidate) =>
            parameter.values.map((value) => parameter.update(candidate.config, value)),
          ),
        ],
        roundWidth(pass + 1),
        beam.map((candidate) => candidate.config),
      )
    }
  }
  stats.timings.beamSearchMs += performance.now() - beamSearchStartedAt
  const fallback = beam[0]
  if (fallback === undefined) throw new Error("Evidence router search produced no candidate")
  const candidates = [...searchContext.archive.values()]
  const selections = selectObjectiveArchiveCandidates(
    candidates,
    ({ quality }) => quality,
    (entry, objective) =>
      evidenceRouterGuardrailsMet(
        samples,
        entry.config,
        fusion,
        guardrailBaselines,
        profile,
        objective,
      ),
    productionQuality,
    profile,
  ).map(({ objective, candidate: selectedCandidate, promotionStatus }) => {
    const candidate = selectedCandidate ?? fallback
    return {
      objective,
      config: candidate.config,
      quality: candidate.quality,
      guardrailsMet: promotionStatus === "eligible",
      promotionStatus,
    }
  })
  const randomCandidate = randomSearch?.candidate ?? fallback
  return {
    selections,
    productionQuality,
    searchDiagnostics: buildSearchDiagnostics(parameters, stats),
    randomCandidate,
    randomCandidates: randomSearch?.candidates ?? 0,
    proxyEvaluations: stats.proxyEvaluations,
    fullEvaluations: stats.fullEvaluations,
  }
}

const withCandidatePool = async <T>(
  samples: readonly WeightSearchSample[],
  fusion: FusionMethod,
  profile: OptimizationProfile,
  options: SearchOptions,
  operation: (pool: CandidateEvaluationPool) => Promise<T>,
): Promise<T> => {
  const pool = await createEvaluationPoolForSamples(samples, fusion, profile, options)
  const closeOnAbort = () => {
    void pool.close()
  }
  options.signal?.addEventListener("abort", closeOnAbort, { once: true })
  if (options.signal?.aborted) closeOnAbort()
  try {
    return await operation(pool)
  } finally {
    options.signal?.removeEventListener("abort", closeOnAbort)
    await pool.close()
  }
}

/** Select weights on development samples, then evaluate unchanged on one validation fold. */
const optimizeWeightsWithPool = async (
  model: string,
  queryKind: QueryKind,
  strategy: WeightSearchResult["strategy"],
  fold: string,
  development: readonly WeightSearchSample[],
  validation: readonly WeightSearchSample[],
  profile: OptimizationProfile = SEARCH_PRIORITY_PROFILE,
  pool: CandidateEvaluationPool,
): Promise<WeightSearchResult> => {
  const selected = await selectBestWeights(
    pool,
    PROXY_PROMOTION_MODE,
    "reranker-top20",
    undefined,
    profile,
  )
  return {
    model,
    queryKind,
    strategy,
    fold,
    developmentQueries: development.length,
    validationQueries: validation.length,
    weights: selected.weights,
    development: selected.quality,
    validation: summarize(validation, selected.weights, "rrf", profile),
    shapleyRecallAt20: shapleyValues(validation, selected.weights, profile),
  }
}

const optimizeWeightsWithOptions = (
  model: string,
  queryKind: QueryKind,
  strategy: WeightSearchResult["strategy"],
  fold: string,
  development: readonly WeightSearchSample[],
  validation: readonly WeightSearchSample[],
  profile: OptimizationProfile = SEARCH_PRIORITY_PROFILE,
  options: SearchOptions,
): Promise<WeightSearchResult> =>
  withCandidatePool(development, "rrf", profile, options, (pool) =>
    optimizeWeightsWithPool(
      model,
      queryKind,
      strategy,
      fold,
      development,
      validation,
      profile,
      pool,
    ),
  )

export const optimizeWeights = (
  model: string,
  queryKind: QueryKind,
  strategy: WeightSearchResult["strategy"],
  fold: string,
  development: readonly WeightSearchSample[],
  validation: readonly WeightSearchSample[],
  profile: OptimizationProfile = SEARCH_PRIORITY_PROFILE,
  options: SearchOptions = { workerCount: 0 },
): Promise<WeightSearchResult> =>
  optimizeWeightsWithOptions(
    model,
    queryKind,
    strategy,
    fold,
    development,
    validation,
    profile,
    options,
  )

/** Select static weights for one fusion method, then evaluate them unchanged on a holdout. */
const optimizeFusionWeightsWithPool = async (
  model: string,
  fusion: FusionMethod,
  strategy: FusionSearchResult["strategy"],
  fold: string,
  development: readonly WeightSearchSample[],
  validationSamples: readonly WeightSearchSample[],
  profile: OptimizationProfile = SEARCH_PRIORITY_PROFILE,
  pool: CandidateEvaluationPool,
): Promise<FusionSearchResult> => {
  const selected = await selectBestWeights(
    pool,
    PROXY_PROMOTION_MODE,
    "reranker-top20",
    undefined,
    profile,
  )
  const validationQuality = summarize(validationSamples, selected.weights, fusion, profile)
  const holdoutBreakdown = buildHoldoutBreakdown(
    validationSamples,
    (partition, evaluationProfile) =>
      summarize(partition, selected.weights, fusion, evaluationProfile),
    profile,
  )
  const guardrailsMet = holdoutBreakdown.every((holdout) => holdout.guardrailsMet)
  return {
    model,
    fusion,
    strategy,
    fold,
    developmentQueries: development.length,
    validationQueries: validationSamples.length,
    weights: selected.weights,
    development: selected.quality,
    validation: validationQuality,
    guardrailsMet,
    promotionStatus: guardrailsMet ? "eligible" : "no-eligible-candidate",
    holdoutBreakdown,
  }
}

const optimizeFusionWeightsWithOptions = (
  model: string,
  fusion: FusionMethod,
  strategy: FusionSearchResult["strategy"],
  fold: string,
  development: readonly WeightSearchSample[],
  validationSamples: readonly WeightSearchSample[],
  profile: OptimizationProfile = SEARCH_PRIORITY_PROFILE,
  options: SearchOptions,
): Promise<FusionSearchResult> =>
  withCandidatePool(development, fusion, profile, options, (pool) =>
    optimizeFusionWeightsWithPool(
      model,
      fusion,
      strategy,
      fold,
      development,
      validationSamples,
      profile,
      pool,
    ),
  )

export const optimizeFusionWeights = (
  model: string,
  fusion: FusionMethod,
  strategy: FusionSearchResult["strategy"],
  fold: string,
  development: readonly WeightSearchSample[],
  validationSamples: readonly WeightSearchSample[],
  profile: OptimizationProfile = SEARCH_PRIORITY_PROFILE,
  options: SearchOptions = { workerCount: 0 },
): Promise<FusionSearchResult> =>
  optimizeFusionWeightsWithOptions(
    model,
    fusion,
    strategy,
    fold,
    development,
    validationSamples,
    profile,
    options,
  )

/** Evaluate the current production router on one development/validation split. */
export const evaluateProductionRouter = (
  model: string,
  strategy: ProductionRouterSearchResult["strategy"],
  fold: string,
  development: readonly WeightSearchSample[],
  validation: readonly WeightSearchSample[],
  profile: OptimizationProfile = SEARCH_PRIORITY_PROFILE,
): ProductionRouterSearchResult => ({
  model,
  strategy,
  fold,
  developmentQueries: development.length,
  validationQueries: validation.length,
  development: summarizeProductionRouter(development, profile),
  validation: summarizeProductionRouter(validation, profile),
})

const withEvidencePools = async <T>(
  samples: readonly WeightSearchSample[],
  fusion: FusionMethod,
  profile: OptimizationProfile,
  options: SearchOptions,
  operation: (
    selection: Awaited<ReturnType<typeof selectBestEvidenceRouter>>,
    fullPool: CandidateEvaluationPool,
  ) => Promise<T>,
): Promise<T> => {
  const preparation = prepareRouterSearch(samples, profile)
  const { evidenceSamples, proxySamples } = preparation
  const fullPool = await createEvaluationPoolForSamples(
    evidenceSamples.map(({ sample }) => sample),
    fusion,
    profile,
    options,
  )
  preparation.stats.timings.candidatePoolInitializationMs +=
    candidatePoolInitializationMs.get(fullPool) ?? 0
  const closeFullPoolOnAbort = () => {
    void fullPool.close()
  }
  options.signal?.addEventListener("abort", closeFullPoolOnAbort, { once: true })
  if (options.signal?.aborted) closeFullPoolOnAbort()
  let proxyPool: CandidateEvaluationPool | undefined
  let closeProxyPoolOnAbort: (() => void) | undefined
  try {
    proxyPool =
      proxySamples === evidenceSamples
        ? fullPool
        : await createEvaluationPoolForSamples(
            proxySamples.map(({ sample }) => sample),
            fusion,
            profile,
            options,
          )
    if (proxyPool !== undefined && proxyPool !== fullPool)
      preparation.stats.timings.candidatePoolInitializationMs +=
        candidatePoolInitializationMs.get(proxyPool) ?? 0
    if (proxyPool !== undefined && proxyPool !== fullPool) {
      closeProxyPoolOnAbort = () => {
        void proxyPool?.close()
      }
      options.signal?.addEventListener("abort", closeProxyPoolOnAbort, { once: true })
      if (options.signal?.aborted) closeProxyPoolOnAbort()
    }
    const selection = await selectBestEvidenceRouter(
      preparation,
      fusion,
      profile,
      fullPool,
      proxyPool,
      resolveRouterSearchMode(options.routerSearchStrategy ?? "proxy-promotion"),
      options.scoutSequence ?? DEFAULT_SCOUT_SEQUENCE,
      options.seedHypotheses ?? false,
      options.beamSchedule ?? "fixed",
    )
    return await operation(selection, fullPool)
  } finally {
    options.signal?.removeEventListener("abort", closeFullPoolOnAbort)
    if (closeProxyPoolOnAbort !== undefined)
      options.signal?.removeEventListener("abort", closeProxyPoolOnAbort)
    if (proxyPool !== undefined && proxyPool !== fullPool) await proxyPool.close()
    await fullPool.close()
  }
}

interface StaticRouterSelection {
  readonly selection: EvidenceRouterSelection
  readonly staticSelection: Awaited<ReturnType<typeof selectStaticWeights>>
}

const selectStaticWeightsForSelections = async (
  selections: readonly EvidenceRouterSelection[],
  fullPool: CandidateEvaluationPool,
  productionQuality: QualitySummary,
  profile: OptimizationProfile,
  mode: RouterSearchMode,
): Promise<readonly StaticRouterSelection[]> => {
  if (mode.name === "successive-halving") {
    const staticSelection = await selectBestWeights(
      fullPool,
      mode,
      "reranker-top20",
      undefined,
      profile,
    )
    return selections.map((selection) => ({ selection, staticSelection }))
  }
  const selected: StaticRouterSelection[] = []
  for (const selection of selections) {
    selected.push({
      selection,
      staticSelection: await selectStaticWeights(
        fullPool,
        mode,
        selection.objective,
        productionQuality,
        profile,
      ),
    })
  }
  return selected
}

const selectStaticWeightsForSearch = (
  dynamicSelection: Awaited<ReturnType<typeof selectBestEvidenceRouter>>,
  fullPool: CandidateEvaluationPool,
  profile: OptimizationProfile,
  options: SearchOptions,
): Promise<readonly StaticRouterSelection[]> =>
  selectStaticWeightsForSelections(
    dynamicSelection.selections,
    fullPool,
    dynamicSelection.productionQuality,
    profile,
    resolveRouterSearchMode(options.routerSearchStrategy ?? "proxy-promotion"),
  )

export const optimizeEvidenceRouter = async (
  model: string,
  fusion: FusionMethod,
  strategy: EvidenceRouterSearchResult["strategy"],
  fold: string,
  development: readonly WeightSearchSample[],
  validation: readonly WeightSearchSample[],
  profile: OptimizationProfile = SEARCH_PRIORITY_PROFILE,
  options: SearchOptions = { workerCount: 0 },
): Promise<readonly EvidenceRouterSearchResult[]> =>
  withEvidencePools(development, fusion, profile, options, async (dynamicSelection, fullPool) => {
    const productionValidation = summarizeProductionRouter(validation, profile)
    const validationEvidence = prepareEvidenceSamples(validation)
    const randomBaseline: SearchBaselineComparison =
      dynamicSelection.randomCandidates === 0
        ? {
            algorithm: "not-run",
            seed: RANDOM_SEARCH_SEED,
            candidates: 0,
            development: summarizeEvidenceRouter(
              [],
              dynamicSelection.randomCandidate.config,
              fusion,
            ),
            validation: summarizeEvidenceRouter(
              [],
              dynamicSelection.randomCandidate.config,
              fusion,
            ),
          }
        : {
            algorithm: "random-scout",
            seed: RANDOM_SEARCH_SEED,
            candidates: dynamicSelection.randomCandidates,
            development: dynamicSelection.randomCandidate.quality,
            validation: summarizeEvidenceRouter(
              validationEvidence,
              dynamicSelection.randomCandidate.config,
              fusion,
              profile,
            ),
          }
    const staticSelections = await selectStaticWeightsForSearch(
      dynamicSelection,
      fullPool,
      profile,
      options,
    )
    const results: EvidenceRouterSearchResult[] = staticSelections.map(
      ({ selection, staticSelection }) => {
        const holdoutBreakdown = buildHoldoutBreakdown(
          validation,
          (partition, evaluationProfile) =>
            summarizeEvidenceRouter(
              prepareEvidenceSamples(partition),
              selection.config,
              fusion,
              evaluationProfile,
            ),
          profile,
          selection.objective,
        )
        const guardrailsMet = holdoutBreakdown.every((holdout) => holdout.guardrailsMet)
        return {
          model,
          fusion,
          objective: selection.objective,
          strategy,
          fold,
          developmentQueries: development.length,
          validationQueries: validation.length,
          staticWeights: staticSelection.weights,
          config: benchmarkRouterConfig(fusion, selection.config),
          staticDevelopment: staticSelection.quality,
          staticValidation: summarize(validation, staticSelection.weights, fusion, profile),
          development: selection.quality,
          validation: summarizeEvidenceRouter(
            validationEvidence,
            selection.config,
            fusion,
            profile,
          ),
          productionDevelopment: dynamicSelection.productionQuality,
          productionValidation,
          guardrailsMet,
          promotionStatus: guardrailsMet ? "eligible" : "no-eligible-candidate",
          proxyEvaluations: dynamicSelection.proxyEvaluations,
          fullEvaluations: dynamicSelection.fullEvaluations,
          searchDiagnostics: dynamicSelection.searchDiagnostics,
          searchBaseline: randomBaseline,
          holdoutBreakdown,
        }
      },
    )
    return results
  })

/** Fit one deployment candidate on all samples after cross-validation has measured generalization. */
const fitRecommendedWeightsWithPool = async (
  model: string,
  queryKind: QueryKind,
  samples: readonly WeightSearchSample[],
  profile: OptimizationProfile = SEARCH_PRIORITY_PROFILE,
  pool: CandidateEvaluationPool,
): Promise<RecommendedWeights> => {
  const selected = await selectBestWeights(
    pool,
    PROXY_PROMOTION_MODE,
    "reranker-top20",
    undefined,
    profile,
  )
  return {
    model,
    queryKind,
    samples: samples.length,
    weights: selected.weights,
    fitQuality: selected.quality,
  }
}

const fitRecommendedWeightsWithOptions = (
  model: string,
  queryKind: QueryKind,
  samples: readonly WeightSearchSample[],
  profile: OptimizationProfile,
  options: SearchOptions,
): Promise<RecommendedWeights> =>
  withCandidatePool(samples, "rrf", profile, options, (pool) =>
    fitRecommendedWeightsWithPool(model, queryKind, samples, profile, pool),
  )

export const fitRecommendedWeights = (
  model: string,
  queryKind: QueryKind,
  samples: readonly WeightSearchSample[],
  profile: OptimizationProfile = SEARCH_PRIORITY_PROFILE,
  options: SearchOptions = { workerCount: 0 },
): Promise<RecommendedWeights> =>
  fitRecommendedWeightsWithOptions(model, queryKind, samples, profile, options)

/** Fit one static candidate for a fusion method across all query forms. */
const fitRecommendedFusionWeightsWithPool = async (
  model: string,
  fusion: FusionMethod,
  samples: readonly WeightSearchSample[],
  profile: OptimizationProfile = SEARCH_PRIORITY_PROFILE,
  pool: CandidateEvaluationPool,
): Promise<RecommendedFusionWeights> => {
  const selected = await selectBestWeights(
    pool,
    PROXY_PROMOTION_MODE,
    "reranker-top20",
    undefined,
    profile,
  )
  const guardrailBaselines = buildGuardrailBaselines(samples, profile)
  const guardrailsMet = fusionGuardrailsMet(
    samples,
    selected.weights,
    fusion,
    guardrailBaselines,
    profile,
  )
  return {
    model,
    fusion,
    samples: samples.length,
    weights: selected.weights,
    fitQuality: selected.quality,
    guardrailsMet,
    promotionStatus: guardrailsMet ? "eligible" : "no-eligible-candidate",
  }
}

const fitRecommendedFusionWeightsWithOptions = (
  model: string,
  fusion: FusionMethod,
  samples: readonly WeightSearchSample[],
  profile: OptimizationProfile,
  options: SearchOptions,
): Promise<RecommendedFusionWeights> =>
  withCandidatePool(samples, fusion, profile, options, (pool) =>
    fitRecommendedFusionWeightsWithPool(model, fusion, samples, profile, pool),
  )

export const fitRecommendedFusionWeights = (
  model: string,
  fusion: FusionMethod,
  samples: readonly WeightSearchSample[],
  profile: OptimizationProfile = SEARCH_PRIORITY_PROFILE,
  options: SearchOptions = { workerCount: 0 },
): Promise<RecommendedFusionWeights> =>
  fitRecommendedFusionWeightsWithOptions(model, fusion, samples, profile, options)

/**
 * Fit one evidence-router candidate on all samples after cross-validation has measured
 * generalization.
 */
const fitRecommendedEvidenceRouterWithOptions = (
  model: string,
  fusion: FusionMethod,
  samples: readonly WeightSearchSample[],
  profile: OptimizationProfile = SEARCH_PRIORITY_PROFILE,
  options: SearchOptions,
): Promise<readonly RecommendedEvidenceRouter[]> =>
  withEvidencePools(samples, fusion, profile, options, async (dynamicSelection, fullPool) => {
    const staticSelections = await selectStaticWeightsForSearch(
      dynamicSelection,
      fullPool,
      profile,
      options,
    )
    const results: RecommendedEvidenceRouter[] = staticSelections.map(
      ({ selection, staticSelection }) => ({
        model,
        fusion,
        objective: selection.objective,
        samples: samples.length,
        staticWeights: staticSelection.weights,
        config: benchmarkRouterConfig(fusion, selection.config),
        staticQuality: staticSelection.quality,
        fitQuality: selection.quality,
        productionQuality: dynamicSelection.productionQuality,
        guardrailsMet: selection.guardrailsMet,
        promotionStatus: selection.promotionStatus,
        proxyEvaluations: dynamicSelection.proxyEvaluations,
        fullEvaluations: dynamicSelection.fullEvaluations,
        searchDiagnostics: dynamicSelection.searchDiagnostics,
      }),
    )
    return results
  })

export const fitRecommendedEvidenceRouter = (
  model: string,
  fusion: FusionMethod,
  samples: readonly WeightSearchSample[],
  profile: OptimizationProfile = SEARCH_PRIORITY_PROFILE,
  options: SearchOptions = { workerCount: 0 },
): Promise<readonly RecommendedEvidenceRouter[]> =>
  fitRecommendedEvidenceRouterWithOptions(model, fusion, samples, profile, options)
