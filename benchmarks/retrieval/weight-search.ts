import type { Chunk } from "../../src/domain/chunk.js"
import type { RankedChunk } from "../../src/domain/ports.js"
import {
  buildRoutingEvidence,
  routeWithEvidence,
  type ChannelCoefficients,
  type EvidenceRouterConfig,
  type RoutingEvidence,
} from "./evidence-router.js"
import { fuseRankings } from "./fusion.js"
import { contextRecallAtBudget, recallAt, reciprocalRank } from "./metrics.js"
import type { ChannelName, ChannelRankings } from "./ranking.js"
import type {
  ChannelWeights,
  EvidenceRouterSearchResult,
  FusionMethod,
  FusionSearchResult,
  QualitySummary,
  QueryKind,
  RecommendedEvidenceRouter,
  RecommendedFusionWeights,
  RecommendedWeights,
  WeightSearchResult,
} from "./types.js"

const CHANNELS: readonly ChannelName[] = ["identity", "camelcase", "bm25", "dense"]
const WEIGHT_LEVELS = [0, 0.5, 1, 2] as const
const STATIC_FINE_WEIGHT_LEVELS = Array.from({ length: 11 }, (_, index) => index / 10)
const DYNAMIC_BASE_LEVELS = Array.from({ length: 10 }, (_, index) => (index + 1) / 10)
const INFLUENCE_LEVELS = Array.from({ length: 11 }, (_, index) => index / 10)
const SIGNED_FINE_LEVELS = Array.from({ length: 21 }, (_, index) => (index - 10) / 10)
const SEARCH_CANDIDATE_DEPTH = 200
const SEARCH_BEAM_WIDTH = 6
const SEARCH_PASSES = 2

const ZERO_COEFFICIENTS: ChannelCoefficients = {
  identity: 0,
  camelcase: 0,
  bm25: 0,
  dense: 0,
}

/** Precomputed query evidence used for cheap fusion and weight experiments. */
export interface WeightSearchSample {
  readonly repository: string
  readonly intentId: string
  readonly groupedFold: number
  readonly query: string
  readonly rankings: ChannelRankings
  readonly targets: readonly ReadonlySet<number>[]
  readonly chunks: readonly Chunk[]
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

const summarize = (
  samples: readonly WeightSearchSample[],
  weights: ChannelWeights,
  fusion: FusionMethod = "rrf",
): QualitySummary => {
  if (samples.length === 0) {
    return { recallAt10: 0, recallAt20: 0, contextRecallAt4096: 0, meanReciprocalRank: 0 }
  }
  let recall10 = 0
  let recall20 = 0
  let contextRecall = 0
  let mrr = 0
  for (const sample of samples) {
    const ranked = fuseWithWeights(sample.rankings, weights, fusion)
    recall10 += recallAt(ranked, sample.targets, 10)
    recall20 += recallAt(ranked, sample.targets, 20)
    contextRecall += contextRecallAtBudget(ranked, sample.targets, sample.chunks, 4_096)
    mrr += reciprocalRank(ranked, sample.targets)
  }
  return {
    recallAt10: recall10 / samples.length,
    recallAt20: recall20 / samples.length,
    contextRecallAt4096: contextRecall / samples.length,
    meanReciprocalRank: mrr / samples.length,
  }
}

const summarizeEvidenceRouter = (
  samples: readonly EvidenceSearchSample[],
  config: EvidenceRouterConfig,
  fusion: FusionMethod,
): QualitySummary => {
  if (samples.length === 0) {
    return { recallAt10: 0, recallAt20: 0, contextRecallAt4096: 0, meanReciprocalRank: 0 }
  }
  let recall10 = 0
  let recall20 = 0
  let contextRecall = 0
  let mrr = 0
  for (const { sample, evidence } of samples) {
    const ranked = fuseWithWeights(sample.rankings, routeWithEvidence(evidence, config), fusion)
    recall10 += recallAt(ranked, sample.targets, 10)
    recall20 += recallAt(ranked, sample.targets, 20)
    contextRecall += contextRecallAtBudget(ranked, sample.targets, sample.chunks, 4_096)
    mrr += reciprocalRank(ranked, sample.targets)
  }
  return {
    recallAt10: recall10 / samples.length,
    recallAt20: recall20 / samples.length,
    contextRecallAt4096: contextRecall / samples.length,
    meanReciprocalRank: mrr / samples.length,
  }
}

const prepareEvidenceSamples = (
  samples: readonly WeightSearchSample[],
): readonly EvidenceSearchSample[] =>
  samples.map((sample) => ({
    sample,
    evidence: buildRoutingEvidence(sample.query, sample.rankings),
  }))

const compareQuality = (left: QualitySummary, right: QualitySummary): number => {
  const leftValues = [
    left.recallAt20,
    left.recallAt10,
    left.contextRecallAt4096,
    left.meanReciprocalRank,
  ]
  const rightValues = [
    right.recallAt20,
    right.recallAt10,
    right.contextRecallAt4096,
    right.meanReciprocalRank,
  ]
  for (let index = 0; index < leftValues.length; index++) {
    if (leftValues[index] > rightValues[index]) return -1
    if (leftValues[index] < rightValues[index]) return 1
  }
  return 0
}

const isBetter = (candidate: QualitySummary, current: QualitySummary): boolean => {
  return compareQuality(candidate, current) < 0
}

const weightCandidates = (): readonly ChannelWeights[] => {
  const candidates: ChannelWeights[] = []
  for (const identity of WEIGHT_LEVELS) {
    for (const camelcase of WEIGHT_LEVELS) {
      for (const bm25 of WEIGHT_LEVELS) {
        for (const dense of WEIGHT_LEVELS) {
          if (identity + camelcase + bm25 + dense === 0) continue
          const max = Math.max(identity, camelcase, bm25, dense)
          candidates.push({
            identity: identity / max,
            camelcase: camelcase / max,
            bm25: bm25 / max,
            dense: dense / max,
          })
        }
      }
    }
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
): ChannelWeights => {
  const values: Record<ChannelName, number> = { identity: 0, camelcase: 0, bm25: 0, dense: 0 }
  const channelCount = CHANNELS.length
  const utility = (mask: number): number => {
    if (mask === 0) return 0
    const coalition: ChannelWeights = {
      identity: mask & 1 ? weights.identity : 0,
      camelcase: mask & 2 ? weights.camelcase : 0,
      bm25: mask & 4 ? weights.bm25 : 0,
      dense: mask & 8 ? weights.dense : 0,
    }
    return summarize(samples, coalition).recallAt20
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
      const quality = summarize(samples, weights, fusion)
      qualityCache.set(key, quality)
      return { weights, quality }
    })
    .sort((left, right) => compareQuality(left.quality, right.quality))
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
): { readonly weights: ChannelWeights; readonly quality: QualitySummary } => {
  const qualityCache = new Map<string, QualitySummary>()
  let beam = rankWeightCandidates(
    samples,
    weightCandidates(),
    SEARCH_BEAM_WIDTH,
    qualityCache,
    fusion,
  )
  for (let pass = 0; pass < SEARCH_PASSES; pass++) {
    for (const channel of CHANNELS) {
      beam = rankWeightCandidates(
        samples,
        beam.flatMap((candidate) =>
          STATIC_FINE_WEIGHT_LEVELS.map((level) => withWeight(candidate.weights, channel, level)),
        ),
        SEARCH_BEAM_WIDTH,
        qualityCache,
        fusion,
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
): readonly ChannelWeights[] => {
  const selected = new Map<
    string,
    { readonly weights: ChannelWeights; readonly quality: QualitySummary }
  >()
  for (const weights of weightCandidates()) {
    const key = activeChannelsKey(weights)
    const quality = summarize(samples, weights, fusion)
    const current = selected.get(key)
    if (current === undefined || isBetter(quality, current.quality))
      selected.set(key, { weights, quality })
  }
  return [...selected.values()].map((entry) => entry.weights)
}

/** Config field containing one coefficient per retrieval channel. */
type InfluenceName =
  | "scoreInfluence"
  | "geometryInfluence"
  | "agreementInfluence"
  | "identifierInfluence"
  | "queryLengthInfluence"

/** One coordinate and its discrete values in the fine-grained router search. */
interface RouterParameter {
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
  })

const emptyRouterConfig = (baseWeights: ChannelWeights): EvidenceRouterConfig => ({
  baseWeights: positiveBaseWeights(baseWeights),
  scoreInfluence: ZERO_COEFFICIENTS,
  geometryInfluence: ZERO_COEFFICIENTS,
  agreementInfluence: ZERO_COEFFICIENTS,
  identifierInfluence: ZERO_COEFFICIENTS,
  queryLengthInfluence: ZERO_COEFFICIENTS,
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
    case "agreementInfluence":
      return { ...config, agreementInfluence: coefficients }
    case "identifierInfluence":
      return { ...config, identifierInfluence: coefficients }
    case "queryLengthInfluence":
      return { ...config, queryLengthInfluence: coefficients }
  }
}

const routerParameters = (): readonly RouterParameter[] => {
  const parameters: RouterParameter[] = CHANNELS.map((channel) => ({
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
    { name: "agreementInfluence", values: INFLUENCE_LEVELS },
    { name: "identifierInfluence", values: SIGNED_FINE_LEVELS },
    { name: "queryLengthInfluence", values: SIGNED_FINE_LEVELS },
  ]
  for (const { name, values } of influences) {
    for (const channel of CHANNELS) {
      parameters.push({
        values,
        update: (config, value) => withInfluence(config, name, channel, value),
      })
    }
  }
  return parameters
}

const coefficientsKey = (coefficients: ChannelCoefficients): string =>
  CHANNELS.map((channel) => coefficients[channel].toFixed(2)).join(":")

const routerKey = (config: EvidenceRouterConfig): string =>
  [
    weightsKey(config.baseWeights),
    coefficientsKey(config.scoreInfluence),
    coefficientsKey(config.geometryInfluence),
    coefficientsKey(config.agreementInfluence),
    coefficientsKey(config.identifierInfluence),
    coefficientsKey(config.queryLengthInfluence),
  ].join("|")

const routerComplexity = (config: EvidenceRouterConfig): number =>
  CHANNELS.reduce(
    (sum, channel) =>
      sum +
      Math.abs(config.scoreInfluence[channel]) +
      Math.abs(config.geometryInfluence[channel]) +
      Math.abs(config.agreementInfluence[channel]) +
      Math.abs(config.identifierInfluence[channel]) +
      Math.abs(config.queryLengthInfluence[channel]),
    0,
  )

const rankRouterCandidates = (
  samples: readonly EvidenceSearchSample[],
  configs: readonly EvidenceRouterConfig[],
  limit: number,
  qualityCache: Map<string, QualitySummary>,
  fusion: FusionMethod,
): readonly RouterCandidate[] => {
  const unique = new Map<string, EvidenceRouterConfig>()
  for (const config of configs) unique.set(routerKey(config), config)
  return [...unique]
    .map(([key, config]) => {
      const cached = qualityCache.get(key)
      if (cached !== undefined) return { config, quality: cached }
      const quality = summarizeEvidenceRouter(samples, config, fusion)
      qualityCache.set(key, quality)
      return { config, quality }
    })
    .sort(
      (left, right) =>
        compareQuality(left.quality, right.quality) ||
        routerComplexity(left.config) - routerComplexity(right.config),
    )
    .slice(0, limit)
}

const selectBestEvidenceRouter = (
  samples: readonly WeightSearchSample[],
  fusion: FusionMethod,
): { readonly config: EvidenceRouterConfig; readonly quality: QualitySummary } => {
  const evidenceSamples = prepareEvidenceSamples(samples)
  const baseSeeds = [
    selectBestWeights(samples, fusion).weights,
    ...selectBestWeightsPerSubset(samples, fusion),
  ].map(emptyRouterConfig)
  const qualityCache = new Map<string, QualitySummary>()
  let beam = rankRouterCandidates(
    evidenceSamples,
    baseSeeds,
    SEARCH_BEAM_WIDTH,
    qualityCache,
    fusion,
  )
  const parameters = routerParameters()
  for (let pass = 0; pass < SEARCH_PASSES; pass++) {
    for (const parameter of parameters) {
      beam = rankRouterCandidates(
        evidenceSamples,
        beam.flatMap((candidate) =>
          parameter.values.map((value) => parameter.update(candidate.config, value)),
        ),
        SEARCH_BEAM_WIDTH,
        qualityCache,
        fusion,
      )
    }
  }
  return beam[0]
}

/** Select weights on development samples, then evaluate unchanged on one validation fold. */
export const optimizeWeights = (
  model: string,
  queryKind: QueryKind,
  strategy: WeightSearchResult["strategy"],
  fold: string,
  development: readonly WeightSearchSample[],
  validation: readonly WeightSearchSample[],
): WeightSearchResult => {
  const selected = selectBestWeights(development)
  return {
    model,
    queryKind,
    strategy,
    fold,
    developmentQueries: development.length,
    validationQueries: validation.length,
    weights: selected.weights,
    development: selected.quality,
    validation: summarize(validation, selected.weights),
    shapleyRecallAt20: shapleyValues(validation, selected.weights),
  }
}

/** Select static weights for one fusion method, then evaluate them unchanged on a holdout. */
export const optimizeFusionWeights = (
  model: string,
  fusion: FusionMethod,
  strategy: FusionSearchResult["strategy"],
  fold: string,
  development: readonly WeightSearchSample[],
  validation: readonly WeightSearchSample[],
): FusionSearchResult => {
  const selected = selectBestWeights(development, fusion)
  return {
    model,
    fusion,
    strategy,
    fold,
    developmentQueries: development.length,
    validationQueries: validation.length,
    weights: selected.weights,
    development: selected.quality,
    validation: summarize(validation, selected.weights, fusion),
  }
}

/** Select one evidence-based router on development queries and evaluate it unchanged on a holdout. */
export const optimizeEvidenceRouter = (
  model: string,
  fusion: FusionMethod,
  strategy: EvidenceRouterSearchResult["strategy"],
  fold: string,
  development: readonly WeightSearchSample[],
  validation: readonly WeightSearchSample[],
): EvidenceRouterSearchResult => {
  const staticSelection = selectBestWeights(development, fusion)
  const dynamicSelection = selectBestEvidenceRouter(development, fusion)
  return {
    model,
    fusion,
    strategy,
    fold,
    developmentQueries: development.length,
    validationQueries: validation.length,
    staticWeights: staticSelection.weights,
    config: dynamicSelection.config,
    staticDevelopment: staticSelection.quality,
    staticValidation: summarize(validation, staticSelection.weights, fusion),
    development: dynamicSelection.quality,
    validation: summarizeEvidenceRouter(
      prepareEvidenceSamples(validation),
      dynamicSelection.config,
      fusion,
    ),
  }
}

/** Fit one deployment candidate on all samples after cross-validation has measured generalization. */
export const fitRecommendedWeights = (
  model: string,
  queryKind: QueryKind,
  samples: readonly WeightSearchSample[],
): RecommendedWeights => {
  const selected = selectBestWeights(samples)
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
): RecommendedFusionWeights => {
  const selected = selectBestWeights(samples, fusion)
  return {
    model,
    fusion,
    samples: samples.length,
    weights: selected.weights,
    fitQuality: selected.quality,
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
): RecommendedEvidenceRouter => {
  const staticSelection = selectBestWeights(samples, fusion)
  const dynamicSelection = selectBestEvidenceRouter(samples, fusion)
  return {
    model,
    fusion,
    samples: samples.length,
    staticWeights: staticSelection.weights,
    config: dynamicSelection.config,
    staticQuality: staticSelection.quality,
    fitQuality: dynamicSelection.quality,
  }
}
