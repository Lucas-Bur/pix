import {
  ZERO_CHANNEL_COEFFICIENTS,
  CHANNEL_NAMES,
  decodeEvidenceRouterConfig,
  type ChannelCoefficients,
  type ChannelName,
  type ChannelWeights,
  type EvidenceRouterConfig as DecodedEvidenceRouterConfig,
  type EvidenceRouterParameters as EvidenceRouterConfig,
  type FusionMethod,
} from "../../../../src/domain/retrieval.js"
import {
  DEFAULT_HALVING_FUNNEL_STRATEGY,
  DEFAULT_PROXY_PROMOTION_STRATEGY,
  DEFAULT_ROUTER_SEARCH_STRATEGY_PARAMETERS,
  DEFAULT_SUCCESSIVE_HALVING_STRATEGY,
  type QualitySummary,
} from "../types.js"

export const CHANNELS: readonly ChannelName[] = CHANNEL_NAMES
export const WEIGHT_LEVELS = [0, 0.5, 1, 2] as const
export const STATIC_FINE_WEIGHT_LEVELS = Array.from({ length: 11 }, (_, index) => index / 10)
export const DYNAMIC_BASE_LEVELS = Array.from({ length: 10 }, (_, index) => (index + 1) / 10)
export const INFLUENCE_LEVELS = Array.from({ length: 11 }, (_, index) => index / 10)
export const SIGNED_FINE_LEVELS = Array.from({ length: 21 }, (_, index) => (index - 10) / 10)
export const SEARCH_CANDIDATE_DEPTH = DEFAULT_ROUTER_SEARCH_STRATEGY_PARAMETERS.candidateDepth
export const SEARCH_BEAM_WIDTH = DEFAULT_ROUTER_SEARCH_STRATEGY_PARAMETERS.beamWidth
export const SEARCH_PASSES = DEFAULT_ROUTER_SEARCH_STRATEGY_PARAMETERS.coordinatePasses
export const SEARCH_GLOBAL_SCOUTS = DEFAULT_ROUTER_SEARCH_STRATEGY_PARAMETERS.globalScouts
export const SEARCH_PROXY_SAMPLE_FRACTION =
  DEFAULT_ROUTER_SEARCH_STRATEGY_PARAMETERS.proxySampleFraction
export const SEARCH_PROXY_MINIMUM_SAMPLES =
  DEFAULT_ROUTER_SEARCH_STRATEGY_PARAMETERS.proxyMinimumSamples
export const SEARCH_PROXY_PROMOTION_FACTOR = DEFAULT_PROXY_PROMOTION_STRATEGY.proxyPromotionFactor
export const SEARCH_HALVING_KEEP_FACTOR = DEFAULT_SUCCESSIVE_HALVING_STRATEGY.halvingKeepFactor
export const SEARCH_FUNNEL_SPREAD_SURVIVORS = DEFAULT_HALVING_FUNNEL_STRATEGY.spreadSurvivors
export const SEARCH_FUNNEL_FINALISTS = DEFAULT_HALVING_FUNNEL_STRATEGY.finalists
export const RANDOM_SEARCH_SEED = DEFAULT_ROUTER_SEARCH_STRATEGY_PARAMETERS.seed || 1

export const normalizeWeights = (weights: ChannelWeights): ChannelWeights => {
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

export const weightsKey = (weights: ChannelWeights): string =>
  CHANNELS.map((channel) => weights[channel].toFixed(4)).join(":")

export const activeChannelsKey = (weights: ChannelWeights): string =>
  CHANNELS.filter((channel) => weights[channel] > 0).join("+")

export const withWeight = (
  weights: ChannelWeights,
  channel: ChannelName,
  value: number,
): ChannelWeights =>
  normalizeWeights({
    ...weights,
    [channel]: value,
  })

export type InfluenceName =
  | "scoreInfluence"
  | "geometryInfluence"
  | "termCoverageInfluence"
  | "pairwiseAgreementInfluence"
  | "denseConfidenceInfluence"
  | "identifierInfluence"
  | "queryLengthInfluence"

/** One coordinate and its discrete values in the fine-grained router search. */
export interface RouterParameter {
  readonly name: string
  readonly values: readonly number[]
  readonly update: (config: EvidenceRouterConfig, value: number) => EvidenceRouterConfig
}

/** Evidence-router candidate and its development quality. */
export interface RouterCandidate {
  readonly config: EvidenceRouterConfig
  readonly quality: QualitySummary
}

export const positiveBaseWeights = (weights: ChannelWeights): ChannelWeights =>
  normalizeWeights({
    identity: Math.max(DYNAMIC_BASE_LEVELS[0], weights.identity),
    camelcase: Math.max(DYNAMIC_BASE_LEVELS[0], weights.camelcase),
    bm25: Math.max(DYNAMIC_BASE_LEVELS[0], weights.bm25),
    dense: Math.max(DYNAMIC_BASE_LEVELS[0], weights.dense),
    sparse: Math.max(DYNAMIC_BASE_LEVELS[0], weights.sparse),
  })

export const emptyRouterConfig = (baseWeights: ChannelWeights): EvidenceRouterConfig => ({
  baseWeights: positiveBaseWeights(baseWeights),
  scoreInfluence: ZERO_CHANNEL_COEFFICIENTS,
  geometryInfluence: ZERO_CHANNEL_COEFFICIENTS,
  termCoverageInfluence: ZERO_CHANNEL_COEFFICIENTS,
  pairwiseAgreementInfluence: ZERO_CHANNEL_COEFFICIENTS,
  denseConfidenceInfluence: ZERO_CHANNEL_COEFFICIENTS,
  identifierInfluence: ZERO_CHANNEL_COEFFICIENTS,
  queryLengthInfluence: ZERO_CHANNEL_COEFFICIENTS,
})

export const benchmarkRouterConfig = (
  fusion: FusionMethod,
  config: EvidenceRouterConfig,
): DecodedEvidenceRouterConfig =>
  decodeEvidenceRouterConfig({
    fusion,
    candidateDepth: SEARCH_CANDIDATE_DEPTH,
    ...config,
  })

export const withInfluence = (
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

export const routerParameters = (): readonly RouterParameter[] => {
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

export const coefficientsKey = (coefficients: ChannelCoefficients): string =>
  CHANNELS.map((channel) => (coefficients[channel] ?? 0).toFixed(2)).join(":")

export const routerKey = (config: EvidenceRouterConfig): string =>
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

export const routerComplexity = (config: EvidenceRouterConfig): number =>
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
