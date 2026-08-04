import type { Chunk } from "../../src/domain/chunk.js"
import type { RankedChunk } from "../../src/domain/ports.js"
import {
  decodeEvidenceRouterConfig,
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
import { fuseRankings } from "../../src/lib/retrieval/fusion.js"
import { BENCHMARK_RRF_BASELINE_CONFIG } from "./baseline.js"
import { contextRecallAtBudget, recallAt, reciprocalRank } from "./metrics.js"
import { SEARCH_PRIORITY_PROFILE, type OptimizationProfile } from "./optimization-profiles.js"
import {
  ROUTER_OBJECTIVES,
  ROUTER_SEARCH_STRATEGY,
  type EvidenceRouterSearchResult,
  type FusionSearchResult,
  type HoldoutQuality,
  type ProductionRrfSearchResult,
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

const fuseWithWeights = (
  rankings: ChannelRankings,
  weights: ChannelWeights,
  fusion: FusionMethod = "rrf",
): readonly RankedChunk[] => fuseRankings(fusion, rankings, weights, SEARCH_CANDIDATE_DEPTH)

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

const summarize = (
  samples: readonly WeightSearchSample[],
  weights: ChannelWeights,
  fusion: FusionMethod = "rrf",
  profile: OptimizationProfile = SEARCH_PRIORITY_PROFILE,
): QualitySummary =>
  summarizeRanked(
    samples,
    (sample) => fuseWithWeights(sample.rankings, weights, fusion),
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
    ({ sample, evidence }) =>
      fuseWithWeights(sample.rankings, routeWithEvidence(evidence, config), fusion),
    ({ sample }) => sample.targets,
    ({ sample }) => sample.chunks,
    ({ sample }) => profile.queryFormWeights[sample.queryKind],
  )

/** Evaluate the historical production RRF router without fitting any benchmark weights. */
const summarizeProductionRrf = (
  samples: readonly WeightSearchSample[],
  profile: OptimizationProfile = SEARCH_PRIORITY_PROFILE,
): QualitySummary =>
  summarizeRanked(
    samples,
    (sample) =>
      fuseWithWeights(
        sample.rankings,
        routeWithEvidence(
          buildRoutingEvidence(sample.query, sample.rankings, sample.termCoverage),
          BENCHMARK_RRF_BASELINE_CONFIG,
        ),
        BENCHMARK_RRF_BASELINE_CONFIG.fusion,
      ),
    (sample) => sample.targets,
    (sample) => sample.chunks,
    (sample) => profile.queryFormWeights[sample.queryKind],
  )

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
  baseline: QualitySummary,
  profile: OptimizationProfile,
): boolean => {
  const holdoutProfile = unweightedProfile(profile)
  const evaluate = (partition: readonly WeightSearchSample[]): boolean => {
    const candidate = summarizeEvidenceRouter(
      prepareEvidenceSamples(partition),
      config,
      fusion,
      holdoutProfile,
    )
    return isWithinGuardrails(
      candidate,
      summarizeProductionRrf(partition, holdoutProfile),
      holdoutProfile,
    )
  }
  return (
    isWithinGuardrails(
      summarizeEvidenceRouter(prepareEvidenceSamples(samples), config, fusion, profile),
      baseline,
      profile,
    ) && guardrailPartitions(samples).every((partition) => evaluate(partition.samples))
  )
}

const fusionGuardrailsMet = (
  samples: readonly WeightSearchSample[],
  weights: ChannelWeights,
  fusion: FusionMethod,
  baseline: QualitySummary,
  profile: OptimizationProfile,
): boolean => {
  const holdoutProfile = unweightedProfile(profile)
  const evaluate = (partition: readonly WeightSearchSample[]): boolean =>
    isWithinGuardrails(
      summarize(partition, weights, fusion, holdoutProfile),
      summarizeProductionRrf(partition, holdoutProfile),
      holdoutProfile,
    )
  return (
    isWithinGuardrails(summarize(samples, weights, fusion, profile), baseline, profile) &&
    guardrailPartitions(samples).every((partition) => evaluate(partition.samples))
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

const buildHoldoutBreakdown = (
  samples: readonly WeightSearchSample[],
  candidate: (samples: readonly WeightSearchSample[]) => QualitySummary,
  profile: OptimizationProfile,
): readonly HoldoutQuality[] => {
  const holdoutProfile = unweightedProfile(profile)
  return guardrailPartitions(samples).map((partition) => {
    const candidateQuality = candidate(partition.samples)
    const baseline = summarizeProductionRrf(partition.samples, holdoutProfile)
    return {
      dimension: partition.dimension,
      name: partition.name,
      queries: partition.samples.length,
      candidate: candidateQuality,
      baseline,
      guardrailsMet: isWithinGuardrails(candidateQuality, baseline, holdoutProfile),
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

const rankWeightCandidates = (
  samples: readonly WeightSearchSample[],
  candidates: readonly ChannelWeights[],
  limit: number,
  qualityCache: Map<string, QualitySummary>,
  fusion: FusionMethod,
  objective: RouterObjective = "reranker-top20",
  baseline?: QualitySummary,
  profile: OptimizationProfile = SEARCH_PRIORITY_PROFILE,
): readonly WeightCandidate[] => {
  const unique = new Map<string, ChannelWeights>()
  for (const candidate of candidates) {
    const normalized = normalizeWeights(candidate)
    unique.set(weightsKey(normalized), normalized)
  }
  return [...unique]
    .map(([key, weights]) => {
      const cached = qualityCache.get(key)
      if (cached !== undefined) return { weights, quality: cached }
      const quality = summarize(samples, weights, fusion, profile)
      qualityCache.set(key, quality)
      return { weights, quality }
    })
    .sort(
      (left, right) =>
        compareObjectiveQuality(left.quality, right.quality, objective, baseline, profile) ||
        activeChannelsKey(left.weights).localeCompare(activeChannelsKey(right.weights)),
    )
    .slice(0, limit)
}

const withWeight = (weights: ChannelWeights, channel: ChannelName, value: number): ChannelWeights =>
  normalizeWeights({
    ...weights,
    [channel]: value,
  })

const selectBestWeights = (
  samples: readonly WeightSearchSample[],
  fusion: FusionMethod = "rrf",
  objective: RouterObjective = "reranker-top20",
  baseline?: QualitySummary,
  profile: OptimizationProfile = SEARCH_PRIORITY_PROFILE,
): { readonly weights: ChannelWeights; readonly quality: QualitySummary } => {
  const qualityCache = new Map<string, QualitySummary>()
  let beam = rankWeightCandidates(
    samples,
    weightCandidates(),
    SEARCH_BEAM_WIDTH,
    qualityCache,
    fusion,
    objective,
    baseline,
    profile,
  )
  for (let pass = 0; pass < SEARCH_PASSES; pass++) {
    for (const channel of CHANNELS) {
      beam = rankWeightCandidates(
        samples,
        [
          // Retain current elites so a later coordinate cannot regress the best development fit.
          ...beam.map((candidate) => candidate.weights),
          ...beam.flatMap((candidate) =>
            STATIC_FINE_WEIGHT_LEVELS.map((level) => withWeight(candidate.weights, channel, level)),
          ),
        ],
        SEARCH_BEAM_WIDTH,
        qualityCache,
        fusion,
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

const selectBestWeightsPerSubset = (
  samples: readonly WeightSearchSample[],
  fusion: FusionMethod,
  profile: OptimizationProfile = SEARCH_PRIORITY_PROFILE,
): readonly ChannelWeights[] => {
  const selected = new Map<
    string,
    { readonly weights: ChannelWeights; readonly quality: QualitySummary }
  >()
  for (const weights of weightCandidates()) {
    const key = activeChannelsKey(weights)
    const quality = summarize(samples, weights, fusion, profile)
    const current = selected.get(key)
    if (
      current === undefined ||
      compareObjectiveQuality(quality, current.quality, "reranker-top20", undefined, profile) < 0
    )
      selected.set(key, { weights, quality })
  }
  return [...selected.values()].map((entry) => entry.weights)
}

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

const buildRandomRouterSeeds = (
  baseSeed: EvidenceRouterConfig,
  parameters: readonly RouterParameter[],
): readonly EvidenceRouterConfig[] => {
  let state = ROUTER_SEARCH_STRATEGY.seed || 1
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

const selectRandomRouter = (
  samples: readonly EvidenceSearchSample[],
  baseSeed: EvidenceRouterConfig,
  parameters: readonly RouterParameter[],
  fusion: FusionMethod,
  baseline: QualitySummary,
  profile: OptimizationProfile,
): { readonly candidate: RouterCandidate; readonly candidates: number } => {
  const candidates = buildRandomRouterSeeds(baseSeed, parameters).map((config) => ({
    config,
    quality: summarizeEvidenceRouter(samples, config, fusion, profile),
  }))
  const candidate = [...candidates].sort((left, right) =>
    compareRouterCandidates(left, right, "reranker-top20", baseline, profile),
  )[0] ?? { config: baseSeed, quality: summarizeEvidenceRouter(samples, baseSeed, fusion, profile) }
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

const rankRouterCandidates = (
  context: RouterSearchContext,
  configs: readonly EvidenceRouterConfig[],
  limit: number,
  protectedConfigs: readonly EvidenceRouterConfig[] = [],
  useProxy = true,
): readonly RouterCandidate[] => {
  const unique = new Map<string, EvidenceRouterConfig>()
  for (const config of configs) unique.set(routerKey(config), config)
  context.stats.rawCandidates += configs.length
  context.stats.uniqueCandidates += unique.size
  context.stats.protectedEliteCount += protectedConfigs.length + context.elites.size
  let fullCandidates = [...unique]
  let proxyKeys: readonly string[] = []
  if (useProxy && context.proxySamples.length < context.samples.length) {
    const rankedProxy = fullCandidates.map(([key, config]) => {
      const cached = context.proxyQualityCache.get(key)
      if (cached !== undefined) {
        context.stats.proxyCacheHits++
        return { key, config, quality: cached }
      }
      const quality = summarizeEvidenceRouter(
        context.proxySamples,
        config,
        context.fusion,
        context.profile,
      )
      context.proxyQualityCache.set(key, quality)
      context.stats.proxyEvaluations++
      return { key, config, quality }
    })
    const selectedProxy = selectObjectiveCandidates(
      rankedProxy.map((candidate) => ({ config: candidate.config, quality: candidate.quality })),
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
  }
  const rankedFull = fullCandidates.map(([key, config]) => {
    const cached = context.qualityCache.get(key)
    if (cached !== undefined) {
      context.stats.fullCacheHits++
      return { config, quality: cached }
    }
    const quality = summarizeEvidenceRouter(
      context.samples,
      config,
      context.fusion,
      context.profile,
    )
    context.qualityCache.set(key, quality)
    context.stats.fullEvaluations++
    return { config, quality }
  })
  if (proxyKeys.length > 0) {
    const fullKeys = new Set(
      rankedFull.slice(0, proxyKeys.length).map((candidate) => routerKey(candidate.config)),
    )
    context.stats.proxyAgreementComparisons += proxyKeys.length
    context.stats.proxyAgreementMatches += proxyKeys.filter((key) => fullKeys.has(key)).length
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

const selectBestEvidenceRouter = (
  samples: readonly WeightSearchSample[],
  fusion: FusionMethod,
  profile: OptimizationProfile = SEARCH_PRIORITY_PROFILE,
): {
  readonly selections: readonly EvidenceRouterSelection[]
  readonly productionQuality: QualitySummary
  readonly proxyEvaluations: number
  readonly fullEvaluations: number
  readonly searchDiagnostics: RouterSearchDiagnostics
  readonly randomCandidate: RouterCandidate
  readonly randomCandidates: number
} => {
  const evidenceSamples = prepareEvidenceSamples(samples)
  const proxySamples = buildProxySamples(evidenceSamples)
  const productionQuality = summarizeProductionRrf(samples, profile)
  const stats: SearchEvaluationStats = {
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
  }
  const searchContext: RouterSearchContext = {
    samples: evidenceSamples,
    proxySamples,
    qualityCache: new Map<string, QualitySummary>(),
    proxyQualityCache: new Map<string, QualitySummary>(),
    elites: new Map<string, RouterCandidate>(),
    archive: new Map<string, RouterCandidate>(),
    baseline: productionQuality,
    proxyBaseline: summarizeProductionRrf(
      proxySamples.map(({ sample }) => sample),
      profile,
    ),
    fusion,
    profile,
    stats,
  }
  const profileSeed: EvidenceRouterConfig = {
    baseWeights: profile.fusionConfig.baseWeights,
    scoreInfluence: profile.fusionConfig.scoreInfluence,
    geometryInfluence: profile.fusionConfig.geometryInfluence,
    termCoverageInfluence: profile.fusionConfig.termCoverageInfluence,
    pairwiseAgreementInfluence: profile.fusionConfig.pairwiseAgreementInfluence,
    denseConfidenceInfluence: profile.fusionConfig.denseConfidenceInfluence,
    identifierInfluence: profile.fusionConfig.identifierInfluence,
    queryLengthInfluence: profile.fusionConfig.queryLengthInfluence,
  }
  const baseSeeds = [
    selectBestWeights(samples, fusion, "reranker-top20", productionQuality, profile).weights,
    ...selectBestWeightsPerSubset(samples, fusion, profile),
  ].map(emptyRouterConfig)
  baseSeeds.unshift(profileSeed)
  const parameters = routerParameters()
  const randomBaseSeed = baseSeeds[0]
  if (randomBaseSeed === undefined) throw new Error("Evidence router search has no base seed")
  const randomSearch = selectRandomRouter(
    evidenceSamples,
    randomBaseSeed,
    parameters,
    fusion,
    productionQuality,
    profile,
  )
  let beam = rankRouterCandidates(
    searchContext,
    [...baseSeeds, ...buildGlobalRouterSeeds(baseSeeds, parameters)],
    SEARCH_BEAM_WIDTH,
    baseSeeds,
  )
  for (let pass = 0; pass < SEARCH_PASSES; pass++) {
    const orderedParameters = pass % 2 === 0 ? parameters : [...parameters].reverse()
    for (const parameter of orderedParameters) {
      beam = rankRouterCandidates(
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
  const fallback = beam[0]
  const candidates = [...searchContext.archive.values()]
  const selections = ROUTER_OBJECTIVES.map((objective) => {
    const rankedCandidates = [...candidates].sort((left, right) =>
      compareRouterCandidates(left, right, objective, productionQuality, profile),
    )
    const { candidate: eligibleCandidate, promotionStatus } = selectEligibleCandidate(
      rankedCandidates,
      (entry) =>
        evidenceRouterGuardrailsMet(samples, entry.config, fusion, productionQuality, profile),
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
    ...stats,
  }
}

/** Select weights on development samples, then evaluate unchanged on one validation fold. */
export const optimizeWeights = (
  model: string,
  queryKind: QueryKind,
  strategy: WeightSearchResult["strategy"],
  fold: string,
  development: readonly WeightSearchSample[],
  validation: readonly WeightSearchSample[],
  profile: OptimizationProfile = SEARCH_PRIORITY_PROFILE,
): WeightSearchResult => {
  const selected = selectBestWeights(development, "rrf", "reranker-top20", undefined, profile)
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

/** Select static weights for one fusion method, then evaluate them unchanged on a holdout. */
export const optimizeFusionWeights = (
  model: string,
  fusion: FusionMethod,
  strategy: FusionSearchResult["strategy"],
  fold: string,
  development: readonly WeightSearchSample[],
  validationSamples: readonly WeightSearchSample[],
  profile: OptimizationProfile = SEARCH_PRIORITY_PROFILE,
): FusionSearchResult => {
  const selected = selectBestWeights(development, fusion, "reranker-top20", undefined, profile)
  const productionDevelopment = summarizeProductionRrf(development, profile)
  const holdoutProfile = unweightedProfile(profile)
  const validationQuality = summarize(validationSamples, selected.weights, fusion, profile)
  const guardrailsMet = fusionGuardrailsMet(
    development,
    selected.weights,
    fusion,
    productionDevelopment,
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

/** Evaluate the current production RRF router on one development/validation split. */
export const evaluateProductionRrf = (
  model: string,
  strategy: ProductionRrfSearchResult["strategy"],
  fold: string,
  development: readonly WeightSearchSample[],
  validation: readonly WeightSearchSample[],
  profile: OptimizationProfile = SEARCH_PRIORITY_PROFILE,
): ProductionRrfSearchResult => ({
  model,
  strategy,
  fold,
  developmentQueries: development.length,
  validationQueries: validation.length,
  development: summarizeProductionRrf(development, profile),
  validation: summarizeProductionRrf(validation, profile),
})

/** Select one evidence-based router on development queries and evaluate it unchanged on a holdout. */
export const optimizeEvidenceRouter = (
  model: string,
  fusion: FusionMethod,
  strategy: EvidenceRouterSearchResult["strategy"],
  fold: string,
  development: readonly WeightSearchSample[],
  validation: readonly WeightSearchSample[],
  profile: OptimizationProfile = SEARCH_PRIORITY_PROFILE,
): readonly EvidenceRouterSearchResult[] => {
  const dynamicSelection = selectBestEvidenceRouter(development, fusion, profile)
  const productionValidation = summarizeProductionRrf(validation, profile)
  const validationEvidence = prepareEvidenceSamples(validation)
  const holdoutProfile = unweightedProfile(profile)
  const randomBaseline: SearchBaselineComparison = {
    algorithm: "random-scout",
    seed: ROUTER_SEARCH_STRATEGY.seed,
    candidates: dynamicSelection.randomCandidates,
    development: dynamicSelection.randomCandidate.quality,
    validation: summarizeEvidenceRouter(
      validationEvidence,
      dynamicSelection.randomCandidate.config,
      fusion,
      profile,
    ),
  }
  return dynamicSelection.selections.map((selection) => {
    const staticSelection = selectBestWeights(
      development,
      fusion,
      selection.objective,
      dynamicSelection.productionQuality,
      profile,
    )
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
      validation: summarizeEvidenceRouter(validationEvidence, selection.config, fusion, profile),
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
    }
  })
}

/** Fit one deployment candidate on all samples after cross-validation has measured generalization. */
export const fitRecommendedWeights = (
  model: string,
  queryKind: QueryKind,
  samples: readonly WeightSearchSample[],
  profile: OptimizationProfile = SEARCH_PRIORITY_PROFILE,
): RecommendedWeights => {
  const selected = selectBestWeights(samples, "rrf", "reranker-top20", undefined, profile)
  return {
    model,
    queryKind,
    samples: samples.length,
    weights: selected.weights,
    fitQuality: selected.quality,
  }
}

/** Fit one static candidate for a fusion method across all query forms. */
export const fitRecommendedFusionWeights = (
  model: string,
  fusion: FusionMethod,
  samples: readonly WeightSearchSample[],
  profile: OptimizationProfile = SEARCH_PRIORITY_PROFILE,
): RecommendedFusionWeights => {
  const selected = selectBestWeights(samples, fusion, "reranker-top20", undefined, profile)
  const productionQuality = summarizeProductionRrf(samples, profile)
  const guardrailsMet = fusionGuardrailsMet(
    samples,
    selected.weights,
    fusion,
    productionQuality,
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

/**
 * Fit one evidence-router candidate on all samples after cross-validation has measured
 * generalization.
 */
export const fitRecommendedEvidenceRouter = (
  model: string,
  fusion: FusionMethod,
  samples: readonly WeightSearchSample[],
  profile: OptimizationProfile = SEARCH_PRIORITY_PROFILE,
): readonly RecommendedEvidenceRouter[] => {
  const dynamicSelection = selectBestEvidenceRouter(samples, fusion, profile)
  return dynamicSelection.selections.map((selection) => {
    const staticSelection = selectBestWeights(
      samples,
      fusion,
      selection.objective,
      dynamicSelection.productionQuality,
      profile,
    )
    return {
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
    }
  })
}
