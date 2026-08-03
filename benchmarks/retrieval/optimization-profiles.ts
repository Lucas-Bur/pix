import { Schema } from "effect"

import {
  EvidenceRouterParametersSchema,
  PRODUCTION_COMPATIBILITY_CONFIG,
  type ChannelWeights,
  type EvidenceRouterParameters,
} from "../../src/domain/retrieval.js"

const NonNegativeNumber = Schema.Number.check(Schema.isGreaterThanOrEqualTo(0))
const QualityMetrics = [
  "recallAt5",
  "recallAt10",
  "recallAt20",
  "recallAt50",
  "contextRecallAt4096",
  "meanReciprocalRank",
] as const
const QualityMetricSchema = Schema.Literals(QualityMetrics)
const OptimizationProfileNames = [
  "search-priority",
  "balanced",
  "code-navigation",
  "basic-exploration",
  "natural-language",
] as const

/** Query-form weights used by the benchmark's weighted aggregate objective. */
const QueryFormWeightsSchema = Schema.Struct({
  identifier: NonNegativeNumber,
  agentTask: NonNegativeNumber,
  naturalQuestion: NonNegativeNumber,
  searchPhrase: NonNegativeNumber,
})

/** Metric priorities and guardrails selected by one benchmark run. */
const MetricObjectiveSchema = Schema.Struct({
  name: Schema.Literals(["direct", "reranker-top20", "reranker-top50"]),
  priority: Schema.Array(QualityMetricSchema),
  guardrailMetrics: Schema.Array(QualityMetricSchema),
  guardrailTolerance: Schema.Number.check(Schema.isBetween({ minimum: 0, maximum: 1 })),
  contextBudget: Schema.Int.check(Schema.isGreaterThan(0)),
})

/** Benchmark-owned optimization profile; selected candidates are validated before production use. */
const OptimizationProfileSchema = Schema.Struct({
  name: Schema.Literals(OptimizationProfileNames),
  fusionConfig: EvidenceRouterParametersSchema,
  queryFormWeights: QueryFormWeightsSchema,
  metricObjective: MetricObjectiveSchema,
})

/** Values used to prioritize and validate one benchmark optimization run. */
export type OptimizationProfile = typeof OptimizationProfileSchema.Type

/** Decode and validate a benchmark optimization profile. */
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
  name: "direct" | "reranker-top20" | "reranker-top50",
  priority: readonly (typeof QualityMetrics)[number][],
): typeof MetricObjectiveSchema.Type => ({
  name,
  priority,
  guardrailMetrics: ["recallAt5", "recallAt10", "recallAt20", "recallAt50", "contextRecallAt4096"],
  guardrailTolerance: 0.01,
  contextBudget: 4_096,
})

const makeProfileFusionConfig = (baseWeights: ChannelWeights): EvidenceRouterParameters => ({
  baseWeights,
  scoreInfluence: { identity: 0, camelcase: 0, bm25: 0, dense: 0, sparse: 0 },
  geometryInfluence: { identity: 0, camelcase: 0, bm25: 0, dense: 0, sparse: 0 },
  termCoverageInfluence: { identity: 0, camelcase: 0, bm25: 0, dense: 0, sparse: 0 },
  pairwiseAgreementInfluence: { identity: 0, camelcase: 0, bm25: 0, dense: 0, sparse: 0 },
  denseConfidenceInfluence: { identity: 0, camelcase: 0, bm25: 0, dense: 0, sparse: 0 },
  identifierInfluence: { identity: 0, camelcase: 0, bm25: 0, dense: 0, sparse: 0 },
  queryLengthInfluence: { identity: 0, camelcase: 0, bm25: 0, dense: 0, sparse: 0 },
})

const profile = (
  name: OptimizationProfile["name"],
  fusionConfig: EvidenceRouterParameters,
  queryFormWeights: typeof QueryFormWeightsSchema.Type,
  metricObjective: typeof MetricObjectiveSchema.Type,
): OptimizationProfile =>
  decodeOptimizationProfile({ name, fusionConfig, queryFormWeights, metricObjective })

const COMPATIBILITY_PROFILE_CONFIG: EvidenceRouterParameters = {
  baseWeights: PRODUCTION_COMPATIBILITY_CONFIG.baseWeights,
  scoreInfluence: PRODUCTION_COMPATIBILITY_CONFIG.scoreInfluence,
  geometryInfluence: PRODUCTION_COMPATIBILITY_CONFIG.geometryInfluence,
  termCoverageInfluence: PRODUCTION_COMPATIBILITY_CONFIG.termCoverageInfluence,
  pairwiseAgreementInfluence: PRODUCTION_COMPATIBILITY_CONFIG.pairwiseAgreementInfluence,
  denseConfidenceInfluence: PRODUCTION_COMPATIBILITY_CONFIG.denseConfidenceInfluence,
  identifierInfluence: PRODUCTION_COMPATIBILITY_CONFIG.identifierInfluence,
  queryLengthInfluence: PRODUCTION_COMPATIBILITY_CONFIG.queryLengthInfluence,
}
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

/** Initial benchmark seed profile from the issue's product-priority objective. */
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

/** Benchmark-owned seed profiles; validated benchmark output can replace their values later. */
export const OPTIMIZATION_PROFILES = {
  "search-priority": SEARCH_PRIORITY_PROFILE,
  balanced: profile(
    "balanced",
    BALANCED_PROFILE_CONFIG,
    { identifier: 1, agentTask: 1, naturalQuestion: 1, searchPhrase: 1 },
    objective("direct", QualityMetrics),
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
