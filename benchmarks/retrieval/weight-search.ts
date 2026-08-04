import type { Chunk } from "../../src/domain/chunk.js"
import type { RankedChunk } from "../../src/domain/ports.js"
import {
  decodeEvidenceRouterConfig,
  PRODUCTION_COMPATIBILITY_CONFIG,
  type ChannelCoefficients,
  type ChannelWeights,
  type EvidenceRouterConfig as DecodedEvidenceRouterConfig,
  type EvidenceRouterParameters as EvidenceRouterConfig,
  type FusionMethod,
  ZERO_CHANNEL_COEFFICIENTS,
  CHANNEL_NAMES,
  type ChannelName,
  type ChannelRankings,
} from "../../src/domain/retrieval.js"
import {
  buildRoutingEvidence,
  routeWithEvidence,
  type QueryTermCoverage,
  type RoutingEvidence,
} from "../../src/lib/retrieval/evidence-router.js"
import { prepareFusion, type PreparedFusionEvaluator } from "./fusion.js"
import { contextRecallAtBudget, recallAt, reciprocalRank } from "./metrics.js"
import { SEARCH_PRIORITY_PROFILE, type OptimizationProfile } from "./optimization-profiles.js"
import {
  ROUTER_OBJECTIVES,
  ROUTER_SEARCH_STRATEGY,
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
import {
  createCandidateEvaluationPool,
  createCandidateEvaluationPoolOnQueue,
  createEvaluationSnapshot,
  type CandidateEvaluationPool,
  type CandidateEvaluationPoolOptions,
  type CandidateEvaluationQueue,
  type EvaluationCandidate,
} from "./worker-pool.js"

const CHANNELS: readonly ChannelName[] = CHANNEL_NAMES
const WEIGHT_LEVELS = [0, 0.5, 1, 2] as const
const STATIC_FINE_WEIGHT_LEVELS = Array.from({ length: 11 }, (_, index) => index / 10)
const DYNAMIC_BASE_LEVELS = Array.from({ length: 10 }, (_, index) => (index + 1) / 10)
const INFLUENCE_LEVELS = Array.from({ length: 11 }, (_, index) => index / 10)
const SIGNED_FINE_LEVELS = Array.from({ length: 21 }, (_, index) => (index - 10) / 10)
const SEARCH_CANDIDATE_DEPTH = ROUTER_SEARCH_STRATEGY.candidateDepth
const SEARCH_BEAM_WIDTH = ROUTER_SEARCH_STRATEGY.beamWidth
const SEARCH_PASSES = ROUTER_SEARCH_STRATEGY.coordinatePasses
const SEARCH_GLOBAL_SCOUTS = ROUTER_SEARCH_STRATEGY.globalScouts
const SEARCH_PROXY_SAMPLE_FRACTION = ROUTER_SEARCH_STRATEGY.proxySampleFraction
const SEARCH_PROXY_MINIMUM_SAMPLES = ROUTER_SEARCH_STRATEGY.proxyMinimumSamples
const SEARCH_PROXY_PROMOTION_FACTOR = ROUTER_SEARCH_STRATEGY.proxyPromotionFactor
const HALTON_PRIMES = [
  2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41, 43, 47, 53, 59, 61, 67, 71, 73, 79, 83, 89, 97,
  101, 103, 107, 109, 113, 127, 131, 137, 139, 149,
] as const

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
interface EvidenceSearchSample {
  readonly sample: WeightSearchSample
  readonly evidence: RoutingEvidence
}

/** Native pool controls plus the cancellation signal owned by the benchmark Effect. */
export interface ParallelSearchOptions extends CandidateEvaluationPoolOptions {
  readonly signal?: AbortSignal
  /** Shared candidate scheduler used to interleave multiple router searches. */
  readonly evaluationQueue?: CandidateEvaluationQueue
}

const preparedFusionCache = new WeakMap<
  WeightSearchSample,
  Map<FusionMethod, PreparedFusionEvaluator>
>()

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
  options: ParallelSearchOptions,
): Promise<CandidateEvaluationPool> => {
  const snapshot = createEvaluationSnapshot(
    samples.map((sample) => ({
      evaluator: preparedFusionEvaluatorFor(sample, fusion),
      targets: sample.targets,
      chunks: sample.chunks,
      sampleWeight: profile.queryFormWeights[sample.queryKind],
    })),
  )
  if (options.evaluationQueue !== undefined)
    return createCandidateEvaluationPoolOnQueue(snapshot, options.evaluationQueue, options.signal)
  return createCandidateEvaluationPool(snapshot, options)
}

const routerEvaluationCandidate = (
  samples: readonly EvidenceSearchSample[],
  config: EvidenceRouterConfig,
): EvaluationCandidate => ({
  weights: samples.map(({ evidence }) => routeWithEvidence(evidence, config)),
})

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
      contextRecallAt4096: 0,
      meanReciprocalRank: 0,
    }
  }
  let recall5 = 0
  let recall10 = 0
  let recall20 = 0
  let recall50 = 0
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
      contextRecallAt4096: 0,
      meanReciprocalRank: 0,
    }
  }
  return {
    recallAt5: recall5 / totalWeight,
    recallAt10: recall10 / totalWeight,
    recallAt20: recall20 / totalWeight,
    recallAt50: recall50 / totalWeight,
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
): boolean => {
  const holdoutProfile = unweightedProfile(profile)
  const evaluate = (partition: GuardrailBaselinePartition): boolean => {
    const candidate = summarizeEvidenceRouter(
      prepareEvidenceSamples(partition.samples),
      config,
      fusion,
      holdoutProfile,
    )
    return isWithinGuardrails(candidate, partition.baseline, holdoutProfile)
  }
  return (
    isWithinGuardrails(
      summarizeEvidenceRouter(prepareEvidenceSamples(samples), config, fusion, profile),
      baselines.overall,
      profile,
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

type QualityMetric =
  | "recallAt5"
  | "recallAt10"
  | "recallAt20"
  | "recallAt50"
  | "contextRecallAt4096"
  | "meanReciprocalRank"

const OBJECTIVE_PRIORITIES: Readonly<Record<RouterObjective, readonly QualityMetric[]>> = {
  direct: [
    "recallAt5",
    "recallAt10",
    "contextRecallAt4096",
    "recallAt20",
    "recallAt50",
    "meanReciprocalRank",
  ],
  "reranker-top20": [
    "recallAt20",
    "recallAt10",
    "recallAt5",
    "contextRecallAt4096",
    "recallAt50",
    "meanReciprocalRank",
  ],
  "reranker-top50": [
    "recallAt50",
    "recallAt20",
    "recallAt10",
    "recallAt5",
    "contextRecallAt4096",
    "meanReciprocalRank",
  ],
}

const isWithinGuardrails = (
  quality: QualitySummary,
  baseline: QualitySummary | undefined,
  profile: OptimizationProfile = SEARCH_PRIORITY_PROFILE,
): boolean =>
  baseline === undefined ||
  profile.metricObjective.guardrailMetrics.every(
    (metric) => quality[metric] >= baseline[metric] - profile.metricObjective.guardrailTolerance,
  )

const unweightedProfile = (profile: OptimizationProfile): OptimizationProfile => ({
  ...profile,
  queryFormWeights: { identifier: 1, agentTask: 1, naturalQuestion: 1, searchPhrase: 1 },
})

interface GuardrailPartition {
  readonly dimension: HoldoutQuality["dimension"]
  readonly name: string
  readonly samples: readonly WeightSearchSample[]
}

const guardrailPartitions = (
  samples: readonly WeightSearchSample[],
): readonly GuardrailPartition[] => {
  const partitions = new Map<string, WeightSearchSample[]>()
  for (const sample of samples) {
    const groups = [
      { dimension: "query-form" as const, name: sample.queryKind },
      { dimension: "repository" as const, name: sample.repository },
    ]
    for (const group of groups) {
      const key = `${group.dimension}:${group.name}`
      const partition = partitions.get(key) ?? []
      partition.push(sample)
      partitions.set(key, partition)
    }
  }
  return [...partitions].map(([key, partition]) => {
    const separator = key.indexOf(":")
    return {
      dimension: key.slice(0, separator) as GuardrailPartition["dimension"],
      name: key.slice(separator + 1),
      samples: partition,
    }
  })
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
  candidate: (samples: readonly WeightSearchSample[]) => QualitySummary,
  profile: OptimizationProfile,
): readonly HoldoutQuality[] => {
  const holdoutProfile = unweightedProfile(profile)
  return buildGuardrailBaselines(samples, profile).partitions.map((partition) => {
    const candidateQuality = candidate(partition.samples)
    return {
      dimension: partition.dimension,
      name: partition.name,
      queries: partition.samples.length,
      candidate: candidateQuality,
      baseline: partition.baseline,
      guardrailsMet: isWithinGuardrails(candidateQuality, partition.baseline, holdoutProfile),
    }
  })
}

const compareObjectiveQuality = (
  left: QualitySummary,
  right: QualitySummary,
  objective: RouterObjective,
  baseline?: QualitySummary,
  profile: OptimizationProfile = SEARCH_PRIORITY_PROFILE,
): number => {
  const leftGuardrails = isWithinGuardrails(left, baseline, profile)
  const rightGuardrails = isWithinGuardrails(right, baseline, profile)
  if (leftGuardrails !== rightGuardrails) return leftGuardrails ? -1 : 1
  const priorities =
    profile.metricObjective.name === objective
      ? profile.metricObjective.priority
      : OBJECTIVE_PRIORITIES[objective]
  for (const metric of priorities) {
    if (left[metric] > right[metric]) return -1
    if (left[metric] < right[metric]) return 1
  }
  return 0
}

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
interface WeightCandidate {
  readonly weights: ChannelWeights
  readonly quality: QualitySummary
}

const normalizeWeights = (weights: ChannelWeights): ChannelWeights => {
  const max = Math.max(...CHANNELS.map((channel) => weights[channel]))
  if (max === 0) return weights
  return {
    identity: weights.identity / max,
    camelcase: weights.camelcase / max,
    bm25: weights.bm25 / max,
    dense: weights.dense / max,
    sparse: weights.sparse / max,
  }
}

const weightsKey = (weights: ChannelWeights): string =>
  CHANNELS.map((channel) => weights[channel].toFixed(4)).join(":")

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
): readonly WeightCandidate[] =>
  entries
    .map(([key, weights]) => {
      const quality = qualityCache.get(key)
      if (quality === undefined) throw new Error(`Missing cached quality for ${key}`)
      return { weights, quality }
    })
    .sort(
      (left, right) =>
        compareObjectiveQuality(left.quality, right.quality, objective, baseline, profile) ||
        activeChannelsKey(left.weights).localeCompare(activeChannelsKey(right.weights)),
    )
    .slice(0, limit)

const storeQualityResults = (
  pending: readonly (readonly [string, unknown])[],
  qualities: readonly QualitySummary[],
  qualityCache: Map<string, QualitySummary>,
  errorMessage: string,
): void => {
  for (let index = 0; index < pending.length; index++) {
    const entry = pending[index]
    const quality = qualities[index]
    if (entry === undefined || quality === undefined) throw new Error(errorMessage)
    qualityCache.set(entry[0], quality)
  }
}

const rankWeightCandidates = async (
  candidates: readonly ChannelWeights[],
  limit: number,
  qualityCache: Map<string, QualitySummary>,
  pool: CandidateEvaluationPool,
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
    "Parallel weight evaluation returned an incomplete result",
  )
  return sortWeightCandidates(unique, qualityCache, limit, objective, baseline, profile)
}

const withWeight = (weights: ChannelWeights, channel: ChannelName, value: number): ChannelWeights =>
  normalizeWeights({
    ...weights,
    [channel]: value,
  })

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
        objective,
        baseline,
        profile,
      )
    }
  }
  return beam[0]
}

const activeChannelsKey = (weights: ChannelWeights): string =>
  CHANNELS.filter((channel) => weights[channel] > 0).join("+")

const selectWeightSubsetCandidates = (
  candidates: readonly ChannelWeights[],
  qualities: readonly QualitySummary[],
  profile: OptimizationProfile,
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
      compareObjectiveQuality(quality, current.quality, "reranker-top20", undefined, profile) < 0
    )
      selected.set(key, { weights, quality })
  }
  return [...selected.values()].map((entry) => entry.weights)
}

const selectBestWeightsPerSubset = async (
  pool: CandidateEvaluationPool,
  profile: OptimizationProfile = SEARCH_PRIORITY_PROFILE,
): Promise<readonly ChannelWeights[]> => {
  const candidates = weightCandidates()
  const qualities = await pool.evaluate(candidates.map((weights) => ({ weights })))
  return selectWeightSubsetCandidates(candidates, qualities, profile)
}

const selectStaticWeights = (
  pool: CandidateEvaluationPool,
  objective: RouterObjective,
  productionQuality: QualitySummary,
  profile: OptimizationProfile,
) => selectBestWeights(pool, objective, productionQuality, profile)

/** Config field containing one coefficient per retrieval channel. */
type InfluenceName =
  | "scoreInfluence"
  | "geometryInfluence"
  | "termCoverageInfluence"
  | "pairwiseAgreementInfluence"
  | "denseConfidenceInfluence"
  | "identifierInfluence"
  | "queryLengthInfluence"

/** One coordinate and its discrete values in the fine-grained router search. */
interface RouterParameter {
  readonly name: string
  readonly values: readonly number[]
  readonly update: (config: EvidenceRouterConfig, value: number) => EvidenceRouterConfig
}

/** Evidence-router candidate and its development quality. */
interface RouterCandidate {
  readonly config: EvidenceRouterConfig
  readonly quality: QualitySummary
}

const positiveBaseWeights = (weights: ChannelWeights): ChannelWeights =>
  normalizeWeights({
    identity: Math.max(DYNAMIC_BASE_LEVELS[0], weights.identity),
    camelcase: Math.max(DYNAMIC_BASE_LEVELS[0], weights.camelcase),
    bm25: Math.max(DYNAMIC_BASE_LEVELS[0], weights.bm25),
    dense: Math.max(DYNAMIC_BASE_LEVELS[0], weights.dense),
    sparse: Math.max(DYNAMIC_BASE_LEVELS[0], weights.sparse),
  })

const emptyRouterConfig = (baseWeights: ChannelWeights): EvidenceRouterConfig => ({
  baseWeights: positiveBaseWeights(baseWeights),
  scoreInfluence: ZERO_CHANNEL_COEFFICIENTS,
  geometryInfluence: ZERO_CHANNEL_COEFFICIENTS,
  termCoverageInfluence: ZERO_CHANNEL_COEFFICIENTS,
  pairwiseAgreementInfluence: ZERO_CHANNEL_COEFFICIENTS,
  denseConfidenceInfluence: ZERO_CHANNEL_COEFFICIENTS,
  identifierInfluence: ZERO_CHANNEL_COEFFICIENTS,
  queryLengthInfluence: ZERO_CHANNEL_COEFFICIENTS,
})

const benchmarkRouterConfig = (
  fusion: FusionMethod,
  config: EvidenceRouterConfig,
): DecodedEvidenceRouterConfig =>
  decodeEvidenceRouterConfig({
    fusion,
    candidateDepth: SEARCH_CANDIDATE_DEPTH,
    ...config,
  })

const withInfluence = (
  config: EvidenceRouterConfig,
  influence: InfluenceName,
  channel: ChannelName,
  value: number,
): EvidenceRouterConfig => {
  const coefficients = { ...config[influence], [channel]: value }
  switch (influence) {
    case "scoreInfluence":
      return { ...config, scoreInfluence: coefficients }
    case "geometryInfluence":
      return { ...config, geometryInfluence: coefficients }
    case "termCoverageInfluence":
      return { ...config, termCoverageInfluence: coefficients }
    case "pairwiseAgreementInfluence":
      return { ...config, pairwiseAgreementInfluence: coefficients }
    case "denseConfidenceInfluence":
      return { ...config, denseConfidenceInfluence: coefficients }
    case "identifierInfluence":
      return { ...config, identifierInfluence: coefficients }
    case "queryLengthInfluence":
      return { ...config, queryLengthInfluence: coefficients }
  }
}

const routerParameters = (): readonly RouterParameter[] => {
  const parameters: RouterParameter[] = CHANNELS.map((channel) => ({
    name: `baseWeights.${channel}`,
    values: DYNAMIC_BASE_LEVELS,
    update: (config, value) => ({
      ...config,
      baseWeights: withWeight(config.baseWeights, channel, value),
    }),
  }))
  const influences: readonly {
    readonly name: InfluenceName
    readonly values: readonly number[]
  }[] = [
    { name: "scoreInfluence", values: INFLUENCE_LEVELS },
    { name: "geometryInfluence", values: INFLUENCE_LEVELS },
    { name: "termCoverageInfluence", values: INFLUENCE_LEVELS },
    { name: "pairwiseAgreementInfluence", values: INFLUENCE_LEVELS },
    { name: "denseConfidenceInfluence", values: INFLUENCE_LEVELS },
    { name: "identifierInfluence", values: SIGNED_FINE_LEVELS },
    { name: "queryLengthInfluence", values: SIGNED_FINE_LEVELS },
  ]
  for (const { name, values } of influences) {
    for (const channel of CHANNELS) {
      parameters.push({
        name: `${name}.${channel}`,
        values,
        update: (config, value) => withInfluence(config, name, channel, value),
      })
    }
  }
  return parameters
}

const buildSearchDiagnostics = (
  parameters: readonly RouterParameter[],
  stats: SearchEvaluationStats,
): RouterSearchDiagnostics => ({
  parameterCount: parameters.length,
  parameterLevels: Object.fromEntries(
    parameters.map((parameter) => [parameter.name, parameter.values]),
  ),
  rawCandidates: stats.rawCandidates,
  uniqueCandidates: stats.uniqueCandidates,
  proxyEvaluations: stats.proxyEvaluations,
  fullEvaluations: stats.fullEvaluations,
  proxyCacheHits: stats.proxyCacheHits,
  fullCacheHits: stats.fullCacheHits,
  proxyPromotions: stats.proxyPromotions,
  proxyFullAgreement:
    stats.proxyAgreementComparisons === 0
      ? 1
      : stats.proxyAgreementMatches / stats.proxyAgreementComparisons,
  protectedEliteCount: stats.protectedEliteCount,
  timings: { ...stats.timings },
})

const radicalInverse = (index: number, base: number): number => {
  let remaining = index
  let place = 1 / base
  let result = 0
  while (remaining > 0) {
    result += (remaining % base) * place
    remaining = Math.floor(remaining / base)
    place /= base
  }
  return result
}

const buildGlobalRouterSeeds = (
  baseSeeds: readonly EvidenceRouterConfig[],
  parameters: readonly RouterParameter[],
): readonly EvidenceRouterConfig[] => {
  if (baseSeeds.length === 0) return []
  const coefficientParameters = parameters.slice(CHANNELS.length)
  if (coefficientParameters.length > HALTON_PRIMES.length)
    throw new Error(
      `Halton sequence needs ${coefficientParameters.length} primes, got ${HALTON_PRIMES.length}`,
    )
  return Array.from({ length: SEARCH_GLOBAL_SCOUTS }, (_, pointIndex) =>
    coefficientParameters.reduce(
      (config, parameter, parameterIndex) => {
        const values = parameter.values
        const prime = HALTON_PRIMES[parameterIndex]
        if (prime === undefined)
          throw new Error(`Halton sequence has no prime for parameter ${parameterIndex}`)
        const valueIndex = Math.min(
          values.length - 1,
          Math.floor(radicalInverse(pointIndex + 1, prime) * values.length),
        )
        return parameter.update(config, values[valueIndex]!)
      },
      baseSeeds[pointIndex % baseSeeds.length]!,
    ),
  )
}

const nextRandom = (state: number): readonly [number, number] => {
  let next = state | 0
  next ^= next << 13
  next ^= next >>> 17
  next ^= next << 5
  const unsigned = next >>> 0
  return [unsigned, unsigned / 4_294_967_296]
}

const RANDOM_SEARCH_SEED = ROUTER_SEARCH_STRATEGY.seed || 1

const buildRandomRouterSeeds = (
  baseSeed: EvidenceRouterConfig,
  parameters: readonly RouterParameter[],
): readonly EvidenceRouterConfig[] => {
  let state: number = RANDOM_SEARCH_SEED
  return Array.from({ length: SEARCH_GLOBAL_SCOUTS }, () =>
    parameters.reduce((config, parameter) => {
      const [next, unit] = nextRandom(state)
      state = next
      const valueIndex = Math.min(
        parameter.values.length - 1,
        Math.floor(unit * parameter.values.length),
      )
      return parameter.update(config, parameter.values[valueIndex]!)
    }, baseSeed),
  )
}

const coefficientsKey = (coefficients: ChannelCoefficients): string =>
  CHANNELS.map((channel) => (coefficients[channel] ?? 0).toFixed(2)).join(":")

const routerKey = (config: EvidenceRouterConfig): string =>
  [
    weightsKey(config.baseWeights),
    coefficientsKey(config.scoreInfluence),
    coefficientsKey(config.geometryInfluence),
    coefficientsKey(config.termCoverageInfluence),
    coefficientsKey(config.pairwiseAgreementInfluence),
    coefficientsKey(config.denseConfidenceInfluence),
    coefficientsKey(config.identifierInfluence),
    coefficientsKey(config.queryLengthInfluence),
  ].join("|")

const routerComplexity = (config: EvidenceRouterConfig): number =>
  CHANNELS.reduce(
    (sum, channel) =>
      sum +
      Math.abs(config.scoreInfluence[channel]) +
      Math.abs(config.geometryInfluence[channel]) +
      Math.abs(config.termCoverageInfluence[channel]) +
      Math.abs(config.pairwiseAgreementInfluence[channel]) +
      Math.abs(config.denseConfidenceInfluence[channel]) +
      Math.abs(config.identifierInfluence[channel]) +
      Math.abs(config.queryLengthInfluence[channel]),
    0,
  )

interface SearchEvaluationStats {
  rawCandidates: number
  uniqueCandidates: number
  proxyEvaluations: number
  fullEvaluations: number
  proxyCacheHits: number
  fullCacheHits: number
  proxyPromotions: number
  proxyAgreementMatches: number
  proxyAgreementComparisons: number
  protectedEliteCount: number
  timings: MutableRouterSearchTimings
}

interface MutableRouterSearchTimings {
  preparationMs: number
  baseWeightSearchMs: number
  randomSearchMs: number
  beamSearchMs: number
  candidatePreparationMs: number
  candidateEvaluationMs: number
  candidateSelectionMs: number
}

interface RouterSearchContext {
  readonly samples: readonly EvidenceSearchSample[]
  readonly proxySamples: readonly EvidenceSearchSample[]
  readonly qualityCache: Map<string, QualitySummary>
  readonly proxyQualityCache: Map<string, QualitySummary>
  readonly elites: Map<string, RouterCandidate>
  readonly archive: Map<string, RouterCandidate>
  readonly baseline: QualitySummary
  readonly proxyBaseline: QualitySummary
  readonly fusion: FusionMethod
  readonly profile: OptimizationProfile
  readonly stats: SearchEvaluationStats
  readonly fullPool: CandidateEvaluationPool
  readonly proxyPool: CandidateEvaluationPool
}

const compareRouterCandidates = (
  left: RouterCandidate,
  right: RouterCandidate,
  objective: RouterObjective,
  baseline: QualitySummary,
  profile: OptimizationProfile,
): number =>
  compareObjectiveQuality(left.quality, right.quality, objective, baseline, profile) ||
  routerComplexity(left.config) - routerComplexity(right.config)

const selectRandomRouter = async (
  samples: readonly EvidenceSearchSample[],
  baseSeed: EvidenceRouterConfig,
  parameters: readonly RouterParameter[],
  pool: CandidateEvaluationPool,
  baseline: QualitySummary,
  profile: OptimizationProfile,
  stats: SearchEvaluationStats,
): Promise<{ readonly candidate: RouterCandidate; readonly candidates: number }> => {
  const configs = buildRandomRouterSeeds(baseSeed, parameters)
  const candidatePreparationStartedAt = performance.now()
  const evaluationCandidates = configs.map((config) => routerEvaluationCandidate(samples, config))
  stats.timings.candidatePreparationMs += performance.now() - candidatePreparationStartedAt
  const candidateEvaluationStartedAt = performance.now()
  const qualities = await pool.evaluate(evaluationCandidates)
  stats.timings.candidateEvaluationMs += performance.now() - candidateEvaluationStartedAt
  const candidates: RouterCandidate[] = []
  for (let index = 0; index < configs.length; index++) {
    const config = configs[index]
    const quality = qualities[index]
    if (config === undefined || quality === undefined)
      throw new Error("Parallel random router search returned an incomplete result")
    candidates.push({ config, quality })
  }
  const candidate = [...candidates].sort((left, right) =>
    compareRouterCandidates(left, right, "reranker-top20", baseline, profile),
  )[0]
  if (candidate === undefined)
    throw new Error("Parallel random router search produced no candidate")
  return { candidate, candidates: candidates.length }
}

const selectObjectiveCandidates = (
  candidates: readonly RouterCandidate[],
  limit: number,
  baseline: QualitySummary,
  profile: OptimizationProfile,
): readonly RouterCandidate[] => {
  const selected = new Map<string, RouterCandidate>()
  const perObjective = Math.max(1, Math.floor(limit / ROUTER_OBJECTIVES.length))
  for (const objective of ROUTER_OBJECTIVES) {
    const ranked = [...candidates]
      .sort((left, right) => compareRouterCandidates(left, right, objective, baseline, profile))
      .slice(0, perObjective)
    for (const candidate of ranked) selected.set(routerKey(candidate.config), candidate)
  }
  if (selected.size < limit) {
    const fallback = [...candidates].sort((left, right) =>
      compareRouterCandidates(left, right, "reranker-top20", baseline, profile),
    )
    for (const candidate of fallback) {
      selected.set(routerKey(candidate.config), candidate)
      if (selected.size >= limit) break
    }
  }
  return [...selected.values()].slice(0, limit)
}

interface RouterEvaluationResult {
  readonly candidates: readonly RouterCandidate[]
  readonly cacheHits: number
  readonly evaluations: number
  readonly candidatePreparationMs: number
  readonly candidateEvaluationMs: number
}

const finalizeRouterCandidates = (
  context: RouterSearchContext,
  rankedFull: readonly RouterCandidate[],
  proxyKeys: readonly string[],
  limit: number,
): readonly RouterCandidate[] => {
  if (proxyKeys.length > 0) {
    const fullRanks = new Map(
      rankedFull.map((candidate, rank) => [routerKey(candidate.config), rank]),
    )
    for (let left = 0; left < proxyKeys.length; left++) {
      const leftRank = fullRanks.get(proxyKeys[left])
      if (leftRank === undefined) continue
      for (let right = left + 1; right < proxyKeys.length; right++) {
        const rightRank = fullRanks.get(proxyKeys[right])
        if (rightRank === undefined) continue
        context.stats.proxyAgreementComparisons++
        if (leftRank < rightRank) context.stats.proxyAgreementMatches++
      }
    }
  }
  for (const candidate of rankedFull) context.archive.set(routerKey(candidate.config), candidate)
  const rankedElites = selectObjectiveCandidates(
    [...context.elites.values(), ...rankedFull],
    SEARCH_BEAM_WIDTH,
    context.baseline,
    context.profile,
  )
  context.elites.clear()
  for (const candidate of rankedElites) context.elites.set(routerKey(candidate.config), candidate)
  return selectObjectiveCandidates(rankedFull, limit, context.baseline, context.profile)
}

const evaluateRouterConfigs = async (
  entries: readonly (readonly [string, EvidenceRouterConfig])[],
  samples: readonly EvidenceSearchSample[],
  pool: CandidateEvaluationPool,
  qualityCache: Map<string, QualitySummary>,
): Promise<RouterEvaluationResult> => {
  const pending = entries.filter(([key]) => qualityCache.get(key) === undefined)
  const candidatePreparationStartedAt = performance.now()
  const evaluationCandidates = pending.map(([, config]) =>
    routerEvaluationCandidate(samples, config),
  )
  const candidatePreparationMs = performance.now() - candidatePreparationStartedAt
  const candidateEvaluationStartedAt = performance.now()
  const qualities = await pool.evaluate(evaluationCandidates)
  const candidateEvaluationMs = performance.now() - candidateEvaluationStartedAt
  storeQualityResults(
    pending,
    qualities,
    qualityCache,
    "Parallel router evaluation returned an incomplete result",
  )
  return {
    candidates: entries.map(([key, config]) => {
      const quality = qualityCache.get(key)
      if (quality === undefined) throw new Error(`Missing cached router quality for ${key}`)
      return { config, quality }
    }),
    cacheHits: entries.length - pending.length,
    evaluations: pending.length,
    candidatePreparationMs,
    candidateEvaluationMs,
  }
}

const rankRouterCandidates = async (
  context: RouterSearchContext,
  configs: readonly EvidenceRouterConfig[],
  limit: number,
  protectedConfigs: readonly EvidenceRouterConfig[] = [],
  useProxy = true,
): Promise<readonly RouterCandidate[]> => {
  const unique = new Map<string, EvidenceRouterConfig>()
  for (const config of configs) unique.set(routerKey(config), config)
  context.stats.rawCandidates += configs.length
  context.stats.uniqueCandidates += unique.size
  context.stats.protectedEliteCount += protectedConfigs.length + context.elites.size
  let fullCandidates = [...unique]
  let proxyKeys: readonly string[] = []
  if (useProxy && context.proxySamples.length < context.samples.length) {
    const rankedProxy = await evaluateRouterConfigs(
      fullCandidates,
      context.proxySamples,
      context.proxyPool,
      context.proxyQualityCache,
    )
    context.stats.proxyCacheHits += rankedProxy.cacheHits
    context.stats.proxyEvaluations += rankedProxy.evaluations
    context.stats.timings.candidatePreparationMs += rankedProxy.candidatePreparationMs
    context.stats.timings.candidateEvaluationMs += rankedProxy.candidateEvaluationMs
    const proxySelectionStartedAt = performance.now()
    const selectedProxy = selectObjectiveCandidates(
      rankedProxy.candidates,
      limit * SEARCH_PROXY_PROMOTION_FACTOR,
      context.proxyBaseline,
      context.profile,
    )
    const selected = new Map(
      selectedProxy.map((candidate) => [routerKey(candidate.config), candidate.config]),
    )
    proxyKeys = selectedProxy.map((candidate) => routerKey(candidate.config))
    context.stats.proxyPromotions += proxyKeys.length
    const protectedKeys = new Set([...protectedConfigs.map(routerKey), ...context.elites.keys()])
    for (const [key, config] of fullCandidates) {
      if (protectedKeys.has(key)) selected.set(key, config)
    }
    fullCandidates = [...selected]
    context.stats.timings.candidateSelectionMs += performance.now() - proxySelectionStartedAt
  }
  const rankedFull = await evaluateRouterConfigs(
    fullCandidates,
    context.samples,
    context.fullPool,
    context.qualityCache,
  )
  context.stats.fullCacheHits += rankedFull.cacheHits
  context.stats.fullEvaluations += rankedFull.evaluations
  context.stats.timings.candidatePreparationMs += rankedFull.candidatePreparationMs
  context.stats.timings.candidateEvaluationMs += rankedFull.candidateEvaluationMs
  const fullSelectionStartedAt = performance.now()
  const selected = finalizeRouterCandidates(context, rankedFull.candidates, proxyKeys, limit)
  context.stats.timings.candidateSelectionMs += performance.now() - fullSelectionStartedAt
  return selected
}

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
    "reranker-top20",
    productionQuality,
    profile,
  )
  const subsetWeights = await selectBestWeightsPerSubset(fullPool, profile)
  const baseSeeds = [baseWeights.weights, ...subsetWeights].map(emptyRouterConfig)
  baseSeeds.unshift(profileSeed)
  stats.timings.baseWeightSearchMs += performance.now() - baseSearchStartedAt
  const parameters = routerParameters()
  const randomBaseSeed = baseSeeds[0]
  if (randomBaseSeed === undefined) throw new Error("Evidence router search has no base seed")
  const randomSearchStartedAt = performance.now()
  const randomSearch = await selectRandomRouter(
    evidenceSamples,
    randomBaseSeed,
    parameters,
    fullPool,
    productionQuality,
    profile,
    stats,
  )
  stats.timings.randomSearchMs += performance.now() - randomSearchStartedAt
  const beamSearchStartedAt = performance.now()
  let beam = await rankRouterCandidates(
    searchContext,
    [...baseSeeds, ...buildGlobalRouterSeeds(baseSeeds, parameters)],
    SEARCH_BEAM_WIDTH,
    baseSeeds,
  )
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
        SEARCH_BEAM_WIDTH,
        beam.map((candidate) => candidate.config),
      )
    }
  }
  stats.timings.beamSearchMs += performance.now() - beamSearchStartedAt
  const fallback = beam[0]
  const candidates = [...searchContext.archive.values()]
  const selections = ROUTER_OBJECTIVES.map((objective) => {
    const rankedCandidates = [...candidates].sort((left, right) =>
      compareRouterCandidates(left, right, objective, productionQuality, profile),
    )
    const { candidate: eligibleCandidate, promotionStatus } = selectEligibleCandidate(
      rankedCandidates,
      (entry) =>
        evidenceRouterGuardrailsMet(samples, entry.config, fusion, guardrailBaselines, profile),
    )
    const candidate = eligibleCandidate ?? rankedCandidates[0] ?? fallback
    if (candidate === undefined) throw new Error("Evidence router search produced no candidate")
    return {
      objective,
      config: candidate.config,
      quality: candidate.quality,
      guardrailsMet: eligibleCandidate !== undefined,
      promotionStatus,
    }
  })
  return {
    selections,
    productionQuality,
    searchDiagnostics: buildSearchDiagnostics(parameters, stats),
    randomCandidate: randomSearch.candidate,
    randomCandidates: randomSearch.candidates,
    proxyEvaluations: stats.proxyEvaluations,
    fullEvaluations: stats.fullEvaluations,
  }
}

const withCandidatePool = async <T>(
  samples: readonly WeightSearchSample[],
  fusion: FusionMethod,
  profile: OptimizationProfile,
  options: ParallelSearchOptions,
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
  const selected = await selectBestWeights(pool, "reranker-top20", undefined, profile)
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
  options: ParallelSearchOptions,
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
): Promise<WeightSearchResult> =>
  optimizeWeightsWithOptions(model, queryKind, strategy, fold, development, validation, profile, {
    workerCount: 0,
  })

export const optimizeWeightsParallel = (
  model: string,
  queryKind: QueryKind,
  strategy: WeightSearchResult["strategy"],
  fold: string,
  development: readonly WeightSearchSample[],
  validation: readonly WeightSearchSample[],
  profile: OptimizationProfile = SEARCH_PRIORITY_PROFILE,
  options: ParallelSearchOptions = {},
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
  const selected = await selectBestWeights(pool, "reranker-top20", undefined, profile)
  const guardrailBaselines = buildGuardrailBaselines(development, profile)
  const holdoutProfile = unweightedProfile(profile)
  const validationQuality = summarize(validationSamples, selected.weights, fusion, profile)
  const guardrailsMet = fusionGuardrailsMet(
    development,
    selected.weights,
    fusion,
    guardrailBaselines,
    profile,
  )
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
    holdoutBreakdown: buildHoldoutBreakdown(
      validationSamples,
      (partition) => summarize(partition, selected.weights, fusion, holdoutProfile),
      profile,
    ),
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
  options: ParallelSearchOptions,
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
): Promise<FusionSearchResult> =>
  optimizeFusionWeightsWithOptions(
    model,
    fusion,
    strategy,
    fold,
    development,
    validationSamples,
    profile,
    { workerCount: 0 },
  )

export const optimizeFusionWeightsParallel = (
  model: string,
  fusion: FusionMethod,
  strategy: FusionSearchResult["strategy"],
  fold: string,
  development: readonly WeightSearchSample[],
  validationSamples: readonly WeightSearchSample[],
  profile: OptimizationProfile = SEARCH_PRIORITY_PROFILE,
  options: ParallelSearchOptions = {},
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

const withParallelEvidencePools = async <T>(
  samples: readonly WeightSearchSample[],
  fusion: FusionMethod,
  profile: OptimizationProfile,
  options: ParallelSearchOptions,
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
): Promise<readonly StaticRouterSelection[]> => {
  const selected: StaticRouterSelection[] = []
  for (const selection of selections) {
    selected.push({
      selection,
      staticSelection: await selectStaticWeights(
        fullPool,
        selection.objective,
        productionQuality,
        profile,
      ),
    })
  }
  return selected
}

const optimizeEvidenceRouterWithPools = async (
  model: string,
  fusion: FusionMethod,
  strategy: EvidenceRouterSearchResult["strategy"],
  fold: string,
  development: readonly WeightSearchSample[],
  validation: readonly WeightSearchSample[],
  profile: OptimizationProfile = SEARCH_PRIORITY_PROFILE,
  options: ParallelSearchOptions = {},
): Promise<readonly EvidenceRouterSearchResult[]> =>
  withParallelEvidencePools(
    development,
    fusion,
    profile,
    options,
    async (dynamicSelection, fullPool) => {
      const productionValidation = summarizeProductionRouter(validation, profile)
      const validationEvidence = prepareEvidenceSamples(validation)
      const holdoutProfile = unweightedProfile(profile)
      const randomBaseline: SearchBaselineComparison = {
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
      const staticSelections = await selectStaticWeightsForSelections(
        dynamicSelection.selections,
        fullPool,
        dynamicSelection.productionQuality,
        profile,
      )
      const results: EvidenceRouterSearchResult[] = staticSelections.map(
        ({ selection, staticSelection }) => ({
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
          guardrailsMet: selection.guardrailsMet,
          promotionStatus: selection.promotionStatus,
          proxyEvaluations: dynamicSelection.proxyEvaluations,
          fullEvaluations: dynamicSelection.fullEvaluations,
          searchDiagnostics: dynamicSelection.searchDiagnostics,
          searchBaseline: randomBaseline,
          holdoutBreakdown: buildHoldoutBreakdown(
            validation,
            (partition) =>
              summarizeEvidenceRouter(
                prepareEvidenceSamples(partition),
                selection.config,
                fusion,
                holdoutProfile,
              ),
            profile,
          ),
        }),
      )
      return results
    },
  )

export const optimizeEvidenceRouterParallel = optimizeEvidenceRouterWithPools

export const optimizeEvidenceRouter = (
  model: string,
  fusion: FusionMethod,
  strategy: EvidenceRouterSearchResult["strategy"],
  fold: string,
  development: readonly WeightSearchSample[],
  validation: readonly WeightSearchSample[],
  profile: OptimizationProfile = SEARCH_PRIORITY_PROFILE,
): Promise<readonly EvidenceRouterSearchResult[]> =>
  optimizeEvidenceRouterParallel(model, fusion, strategy, fold, development, validation, profile, {
    workerCount: 0,
  })

/** Fit one deployment candidate on all samples after cross-validation has measured generalization. */
const fitRecommendedWeightsWithPool = async (
  model: string,
  queryKind: QueryKind,
  samples: readonly WeightSearchSample[],
  profile: OptimizationProfile = SEARCH_PRIORITY_PROFILE,
  pool: CandidateEvaluationPool,
): Promise<RecommendedWeights> => {
  const selected = await selectBestWeights(pool, "reranker-top20", undefined, profile)
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
  options: ParallelSearchOptions,
): Promise<RecommendedWeights> =>
  withCandidatePool(samples, "rrf", profile, options, (pool) =>
    fitRecommendedWeightsWithPool(model, queryKind, samples, profile, pool),
  )

export const fitRecommendedWeights = (
  model: string,
  queryKind: QueryKind,
  samples: readonly WeightSearchSample[],
  profile: OptimizationProfile = SEARCH_PRIORITY_PROFILE,
): Promise<RecommendedWeights> =>
  fitRecommendedWeightsWithOptions(model, queryKind, samples, profile, { workerCount: 0 })

export const fitRecommendedWeightsParallel = (
  model: string,
  queryKind: QueryKind,
  samples: readonly WeightSearchSample[],
  profile: OptimizationProfile = SEARCH_PRIORITY_PROFILE,
  options: ParallelSearchOptions = {},
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
  const selected = await selectBestWeights(pool, "reranker-top20", undefined, profile)
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
  options: ParallelSearchOptions,
): Promise<RecommendedFusionWeights> =>
  withCandidatePool(samples, fusion, profile, options, (pool) =>
    fitRecommendedFusionWeightsWithPool(model, fusion, samples, profile, pool),
  )

export const fitRecommendedFusionWeights = (
  model: string,
  fusion: FusionMethod,
  samples: readonly WeightSearchSample[],
  profile: OptimizationProfile = SEARCH_PRIORITY_PROFILE,
): Promise<RecommendedFusionWeights> =>
  fitRecommendedFusionWeightsWithOptions(model, fusion, samples, profile, { workerCount: 0 })

export const fitRecommendedFusionWeightsParallel = (
  model: string,
  fusion: FusionMethod,
  samples: readonly WeightSearchSample[],
  profile: OptimizationProfile = SEARCH_PRIORITY_PROFILE,
  options: ParallelSearchOptions = {},
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
  options: ParallelSearchOptions,
): Promise<readonly RecommendedEvidenceRouter[]> =>
  withParallelEvidencePools(
    samples,
    fusion,
    profile,
    options,
    async (dynamicSelection, fullPool) => {
      const staticSelections = await selectStaticWeightsForSelections(
        dynamicSelection.selections,
        fullPool,
        dynamicSelection.productionQuality,
        profile,
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
    },
  )

export const fitRecommendedEvidenceRouter = (
  model: string,
  fusion: FusionMethod,
  samples: readonly WeightSearchSample[],
  profile: OptimizationProfile = SEARCH_PRIORITY_PROFILE,
): Promise<readonly RecommendedEvidenceRouter[]> =>
  fitRecommendedEvidenceRouterWithOptions(model, fusion, samples, profile, { workerCount: 0 })

export const fitRecommendedEvidenceRouterParallel = (
  model: string,
  fusion: FusionMethod,
  samples: readonly WeightSearchSample[],
  profile: OptimizationProfile = SEARCH_PRIORITY_PROFILE,
  options: ParallelSearchOptions = {},
): Promise<readonly RecommendedEvidenceRouter[]> =>
  fitRecommendedEvidenceRouterWithOptions(model, fusion, samples, profile, options)
