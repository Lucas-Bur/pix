import { Schema } from "effect"

import type { RankedChunk } from "./ports.js"

const PositiveInt = Schema.Int.check(Schema.isGreaterThan(0))
const NonNegativeNumber = Schema.Number.check(Schema.isGreaterThanOrEqualTo(0))
const BoundedInfluence = Schema.Number.check(Schema.isBetween({ minimum: 0, maximum: 1 }))
const SignedInfluence = Schema.Number.check(Schema.isBetween({ minimum: -1, maximum: 1 }))

/** Physical retrieval channels that can contribute to a fused ranking. */
export const CHANNEL_NAMES = ["identity", "camelcase", "bm25", "dense", "sparse"] as const

/** Name of one physical retrieval channel. */
export type ChannelName = (typeof CHANNEL_NAMES)[number]

/** One ranked result list for every physical retrieval channel. */
export type ChannelRankings = Readonly<Record<ChannelName, readonly RankedChunk[]>>

/** Supported score or rank fusion algorithms. */
export const FUSION_METHODS = ["rrf", "relative-score", "dbsf"] as const

/** Fusion algorithm name. */
const FusionMethodSchema = Schema.Literals(FUSION_METHODS)

/** Decoded fusion algorithm name. */
export type FusionMethod = typeof FusionMethodSchema.Type

/** Non-negative weight assigned to each physical retrieval channel. */
const ChannelWeightsSchema = Schema.Struct({
  identity: NonNegativeNumber,
  camelcase: NonNegativeNumber,
  bm25: NonNegativeNumber,
  dense: NonNegativeNumber,
  sparse: NonNegativeNumber,
})

/** Decoded per-channel fusion weights. */
export type ChannelWeights = typeof ChannelWeightsSchema.Type

/** Coefficients for evidence signals, bounded to the router's supported range. */
const ChannelCoefficientsSchema = Schema.Struct({
  identity: SignedInfluence,
  camelcase: SignedInfluence,
  bm25: SignedInfluence,
  dense: SignedInfluence,
  sparse: SignedInfluence,
})

/** Decoded per-channel evidence coefficients. */
export type ChannelCoefficients = typeof ChannelCoefficientsSchema.Type

const NonNegativeChannelCoefficientsSchema = Schema.Struct({
  identity: BoundedInfluence,
  camelcase: BoundedInfluence,
  bm25: BoundedInfluence,
  dense: BoundedInfluence,
  sparse: BoundedInfluence,
})

/** Versioned, explainable production fusion and evidence-router configuration. */
const EvidenceRouterConfigSchema = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  fusion: FusionMethodSchema,
  candidateDepth: PositiveInt,
  baseWeights: ChannelWeightsSchema,
  scoreInfluence: NonNegativeChannelCoefficientsSchema,
  geometryInfluence: NonNegativeChannelCoefficientsSchema,
  termCoverageInfluence: NonNegativeChannelCoefficientsSchema,
  pairwiseAgreementInfluence: NonNegativeChannelCoefficientsSchema,
  denseConfidenceInfluence: NonNegativeChannelCoefficientsSchema,
  identifierInfluence: ChannelCoefficientsSchema,
  queryLengthInfluence: ChannelCoefficientsSchema,
})

/** Decoded production fusion and evidence-router configuration. */
export type EvidenceRouterConfig = typeof EvidenceRouterConfigSchema.Type

/** Router parameters independent of the selected fusion method and artifact metadata. */
export type EvidenceRouterParameters = Omit<
  EvidenceRouterConfig,
  "schemaVersion" | "fusion" | "candidateDepth"
>

/** Decode and validate a versioned fusion/router configuration at a boundary. */
export const decodeEvidenceRouterConfig = (input: unknown): EvidenceRouterConfig =>
  Schema.decodeUnknownSync(EvidenceRouterConfigSchema)(input)

/** Names of metrics that can be prioritized by an optimization profile. */
const QUALITY_METRICS = [
  "recallAt5",
  "recallAt10",
  "recallAt20",
  "recallAt50",
  "contextRecallAt4096",
  "meanReciprocalRank",
] as const

/** Metric name used by benchmark quality objectives. */
const QualityMetricSchema = Schema.Literals(QUALITY_METRICS)

/** Decoded metric name used by benchmark quality objectives. */
type QualityMetric = typeof QualityMetricSchema.Type

/** Names of explicit benchmark metric objectives. */
const METRIC_OBJECTIVE_NAMES = ["direct", "reranker-top20", "reranker-top50"] as const

/** Decoded benchmark metric objective name. */
const MetricObjectiveNameSchema = Schema.Literals(METRIC_OBJECTIVE_NAMES)

/** Decoded benchmark metric objective name. */
type MetricObjectiveName = typeof MetricObjectiveNameSchema.Type

/** Query-form weights used to build a weighted aggregate objective. */
const QueryFormWeightsSchema = Schema.Struct({
  identifier: NonNegativeNumber,
  agentTask: NonNegativeNumber,
  naturalQuestion: NonNegativeNumber,
  searchPhrase: NonNegativeNumber,
})

/** Decoded query-form objective weights. */
type QueryFormWeights = typeof QueryFormWeightsSchema.Type

/** Metric priorities and guardrails selected by an optimization profile. */
const MetricObjectiveSchema = Schema.Struct({
  name: MetricObjectiveNameSchema,
  priority: Schema.Array(QualityMetricSchema),
  guardrailMetrics: Schema.Array(QualityMetricSchema),
  guardrailTolerance: Schema.Number.check(Schema.isBetween({ minimum: 0, maximum: 1 })),
  contextBudget: PositiveInt,
})

/** Decoded metric objective configuration. */
type MetricObjective = typeof MetricObjectiveSchema.Type

/** Explicit optimization profile names. */
const OPTIMIZATION_PROFILE_NAMES = [
  "search-priority",
  "balanced",
  "code-navigation",
  "basic-exploration",
  "natural-language",
] as const

/** Schema for a versioned benchmark optimization profile. */
const OptimizationProfileSchema = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  name: Schema.Literals(OPTIMIZATION_PROFILE_NAMES),
  fusionConfig: EvidenceRouterConfigSchema,
  queryFormWeights: QueryFormWeightsSchema,
  metricObjective: MetricObjectiveSchema,
})

/** Decoded versioned benchmark optimization profile. */
export type OptimizationProfile = typeof OptimizationProfileSchema.Type

/** Decode and validate an optimization profile, including its non-empty objective invariant. */
export const decodeOptimizationProfile = (input: unknown): OptimizationProfile => {
  const profile = Schema.decodeUnknownSync(OptimizationProfileSchema)(input)
  if (!Object.values(profile.queryFormWeights).some((weight) => weight > 0))
    throw new Error("Optimization profile must assign a positive weight to one query form")
  if (profile.metricObjective.priority.length === 0)
    throw new Error("Optimization profile must prioritize at least one metric")
  if (profile.metricObjective.guardrailMetrics.length === 0)
    throw new Error("Optimization profile must define at least one guardrail metric")
  return profile
}

const objective = (
  name: MetricObjectiveName,
  priority: readonly QualityMetric[],
): MetricObjective => ({
  name,
  priority,
  guardrailMetrics: ["recallAt5", "recallAt10", "recallAt20", "recallAt50", "contextRecallAt4096"],
  guardrailTolerance: 0.01,
  contextBudget: 4_096,
})

const makeProfileFusionConfig = (baseWeights: ChannelWeights): EvidenceRouterConfig =>
  decodeEvidenceRouterConfig({
    schemaVersion: 1,
    fusion: "rrf",
    candidateDepth: 200,
    baseWeights,
    scoreInfluence: { identity: 0, camelcase: 0, bm25: 0, dense: 0, sparse: 0 },
    geometryInfluence: { identity: 0, camelcase: 0, bm25: 0, dense: 0, sparse: 0 },
    termCoverageInfluence: { identity: 0, camelcase: 0, bm25: 0, dense: 0, sparse: 0 },
    pairwiseAgreementInfluence: { identity: 0, camelcase: 0, bm25: 0, dense: 0, sparse: 0 },
    denseConfidenceInfluence: { identity: 0, camelcase: 0, bm25: 0, dense: 0, sparse: 0 },
    identifierInfluence: { identity: 0, camelcase: 0, bm25: 0, dense: 0, sparse: 0 },
    queryLengthInfluence: { identity: 0, camelcase: 0, bm25: 0, dense: 0, sparse: 0 },
  })

const COMPATIBILITY_PROFILE_CONFIG = makeProfileFusionConfig({
  identity: 3,
  camelcase: 1.5,
  bm25: 1,
  dense: 1,
  sparse: 1,
})
const BALANCED_PROFILE_CONFIG = makeProfileFusionConfig({
  identity: 1,
  camelcase: 1,
  bm25: 1,
  dense: 1,
  sparse: 1,
})
const CODE_NAVIGATION_PROFILE_CONFIG = makeProfileFusionConfig({
  identity: 4,
  camelcase: 2,
  bm25: 1.5,
  dense: 0.5,
  sparse: 1,
})
const BASIC_EXPLORATION_PROFILE_CONFIG = makeProfileFusionConfig({
  identity: 1,
  camelcase: 1,
  bm25: 1,
  dense: 2,
  sparse: 1,
})
const NATURAL_LANGUAGE_PROFILE_CONFIG = makeProfileFusionConfig({
  identity: 0.5,
  camelcase: 0.5,
  bm25: 1,
  dense: 2,
  sparse: 1.5,
})

const profile = (
  name: OptimizationProfile["name"],
  fusionConfig: EvidenceRouterConfig,
  queryFormWeights: QueryFormWeights,
  metricObjective: MetricObjective,
): OptimizationProfile =>
  decodeOptimizationProfile({
    schemaVersion: 1,
    name,
    fusionConfig,
    queryFormWeights,
    metricObjective,
  })

/** First weighted benchmark objective: identifier/agent/natural/search = 1/2/3/4. */
export const SEARCH_PRIORITY_PROFILE = profile(
  "search-priority",
  COMPATIBILITY_PROFILE_CONFIG,
  { identifier: 1, agentTask: 2, naturalQuestion: 3, searchPhrase: 4 },
  objective("direct", [
    "recallAt5",
    "recallAt10",
    "contextRecallAt4096",
    "recallAt20",
    "recallAt50",
    "meanReciprocalRank",
  ]),
)

/** Explicit profiles available for future product-specific benchmark goals. */
export const OPTIMIZATION_PROFILES = {
  "search-priority": SEARCH_PRIORITY_PROFILE,
  balanced: profile(
    "balanced",
    BALANCED_PROFILE_CONFIG,
    { identifier: 1, agentTask: 1, naturalQuestion: 1, searchPhrase: 1 },
    objective("direct", QUALITY_METRICS),
  ),
  "code-navigation": profile(
    "code-navigation",
    CODE_NAVIGATION_PROFILE_CONFIG,
    { identifier: 4, agentTask: 3, naturalQuestion: 1, searchPhrase: 3 },
    objective("reranker-top20", [
      "recallAt20",
      "recallAt10",
      "recallAt5",
      "contextRecallAt4096",
      "recallAt50",
      "meanReciprocalRank",
    ]),
  ),
  "basic-exploration": profile(
    "basic-exploration",
    BASIC_EXPLORATION_PROFILE_CONFIG,
    { identifier: 1, agentTask: 3, naturalQuestion: 4, searchPhrase: 2 },
    objective("direct", [
      "recallAt5",
      "recallAt10",
      "recallAt20",
      "recallAt50",
      "contextRecallAt4096",
      "meanReciprocalRank",
    ]),
  ),
  "natural-language": profile(
    "natural-language",
    NATURAL_LANGUAGE_PROFILE_CONFIG,
    { identifier: 1, agentTask: 3, naturalQuestion: 4, searchPhrase: 3 },
    objective("reranker-top50", [
      "recallAt50",
      "recallAt20",
      "recallAt10",
      "recallAt5",
      "contextRecallAt4096",
      "meanReciprocalRank",
    ]),
  ),
} as const

/** Default production configuration that preserves the current RRF compatibility path. */
export const PRODUCTION_COMPATIBILITY_CONFIG = COMPATIBILITY_PROFILE_CONFIG
