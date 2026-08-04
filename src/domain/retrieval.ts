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

const EvidenceRouterParameterFields = {
  baseWeights: ChannelWeightsSchema,
  scoreInfluence: NonNegativeChannelCoefficientsSchema,
  geometryInfluence: NonNegativeChannelCoefficientsSchema,
  termCoverageInfluence: NonNegativeChannelCoefficientsSchema,
  pairwiseAgreementInfluence: NonNegativeChannelCoefficientsSchema,
  denseConfidenceInfluence: NonNegativeChannelCoefficientsSchema,
  identifierInfluence: ChannelCoefficientsSchema,
  queryLengthInfluence: ChannelCoefficientsSchema,
} as const

/** Evidence-router parameters that a validated benchmark candidate can promote to production. */
export const EvidenceRouterParametersSchema = Schema.Struct(EvidenceRouterParameterFields)

/** Explainable production fusion and evidence-router configuration. */
const EvidenceRouterConfigSchema = Schema.Struct({
  fusion: FusionMethodSchema,
  candidateDepth: PositiveInt,
  ...EvidenceRouterParameterFields,
})

/** Decoded production fusion and evidence-router configuration. */
export type EvidenceRouterConfig = typeof EvidenceRouterConfigSchema.Type

/** Router parameters independent of the selected fusion method and config metadata. */
export type EvidenceRouterParameters = typeof EvidenceRouterParametersSchema.Type

/** Decode and validate a fusion/router configuration at a boundary. */
export const decodeEvidenceRouterConfig = (input: unknown): EvidenceRouterConfig =>
  Schema.decodeUnknownSync(EvidenceRouterConfigSchema)(input)

const ZERO_COEFFICIENTS: ChannelCoefficients = {
  identity: 0,
  camelcase: 0,
  bm25: 0,
  dense: 0,
  sparse: 0,
}

/** Explicit profile names accepted by the production query boundary. */
const PRODUCTION_PROFILE_NAMES = [
  "compatibility",
  "balanced",
  "code-navigation",
  "natural-language",
] as const

/**
 * Full configuration promoted from the `search-priority` direct DBSF candidate in the benchmark.
 * The artifact's static weights are not used here; production executes this dynamic router
 * configuration.
 */
export const PROMOTED_SEARCH_PRIORITY_CONFIG: EvidenceRouterConfig = decodeEvidenceRouterConfig({
  fusion: "dbsf",
  candidateDepth: 200,
  baseWeights: { identity: 0.6, camelcase: 0.5, bm25: 0.9, dense: 1, sparse: 0.1 },
  scoreInfluence: { identity: 0, camelcase: 0.5, bm25: 0.8, dense: 0.6, sparse: 0 },
  geometryInfluence: { identity: 0, camelcase: 0.6, bm25: 0.1, dense: 0, sparse: 0 },
  termCoverageInfluence: { identity: 0, camelcase: 0.1, bm25: 0.2, dense: 0, sparse: 0 },
  pairwiseAgreementInfluence: {
    identity: 0,
    camelcase: 0.9,
    bm25: 0.8,
    dense: 0.8,
    sparse: 0.7,
  },
  denseConfidenceInfluence: { identity: 0, camelcase: 0, bm25: 0, dense: 0.6, sparse: 0 },
  identifierInfluence: { identity: 0, camelcase: 0.4, bm25: -0.1, dense: -0.1, sparse: -0.7 },
  queryLengthInfluence: { identity: 0, camelcase: -0.3, bm25: -0.4, dense: -0.3, sparse: -0.4 },
})

/** Production retrieval profile name. */
export const ProductionProfileNameSchema = Schema.Literals(PRODUCTION_PROFILE_NAMES)

/** Production profile selected explicitly by a query caller. */
export type ProductionProfileName = typeof ProductionProfileNameSchema.Type

/** Resolved production profile configuration. */
export interface ProductionProfile {
  readonly name: ProductionProfileName
  readonly config: EvidenceRouterConfig
  readonly experimental: boolean
}

/** Build an experimental profile with an authored base prior and the promoted evidence model. */
const makeProductionProfileConfig = (baseWeights: ChannelWeights): EvidenceRouterConfig =>
  decodeEvidenceRouterConfig({
    ...PROMOTED_SEARCH_PRIORITY_CONFIG,
    baseWeights,
  })

const makeCompatibilityConfig = (fusion: FusionMethod): EvidenceRouterConfig =>
  decodeEvidenceRouterConfig({
    fusion,
    candidateDepth: 200,
    baseWeights: {
      identity: 3,
      camelcase: 1.5,
      bm25: 1,
      dense: 1,
      sparse: 1,
    },
    scoreInfluence: ZERO_COEFFICIENTS,
    geometryInfluence: ZERO_COEFFICIENTS,
    termCoverageInfluence: ZERO_COEFFICIENTS,
    pairwiseAgreementInfluence: ZERO_COEFFICIENTS,
    denseConfidenceInfluence: ZERO_COEFFICIENTS,
    identifierInfluence: ZERO_COEFFICIENTS,
    queryLengthInfluence: { ...ZERO_COEFFICIENTS, bm25: -1, dense: 1 },
  })

/** Historical RRF configuration retained as the benchmark guardrail baseline. */
export const PRODUCTION_RRF_BASELINE_CONFIG = makeCompatibilityConfig("rrf")

/**
 * Current production compatibility profile. This is the promoted dynamic DBSF configuration for the
 * `search-priority` direct objective; broader matrix validation remains benchmark follow-up.
 */
export const PRODUCTION_COMPATIBILITY_CONFIG = PROMOTED_SEARCH_PRIORITY_CONFIG

/** Explicitly selectable production profiles; non-compatibility profiles remain opt-in candidates. */
export const PRODUCTION_PROFILES = {
  compatibility: {
    name: "compatibility",
    config: PRODUCTION_COMPATIBILITY_CONFIG,
    experimental: false,
  },
  balanced: {
    name: "balanced",
    config: makeProductionProfileConfig({
      identity: 1,
      camelcase: 1,
      bm25: 1,
      dense: 1,
      sparse: 1,
    }),
    experimental: true,
  },
  "code-navigation": {
    name: "code-navigation",
    config: makeProductionProfileConfig({
      identity: 4,
      camelcase: 2,
      bm25: 1.5,
      dense: 0.5,
      sparse: 1,
    }),
    experimental: true,
  },
  "natural-language": {
    name: "natural-language",
    config: makeProductionProfileConfig({
      identity: 0.5,
      camelcase: 0.5,
      bm25: 1,
      dense: 2,
      sparse: 1.5,
    }),
    experimental: true,
  },
} as const satisfies Readonly<Record<ProductionProfileName, ProductionProfile>>

/** Resolve a caller-selected profile; compatibility is the safe default. */
export const resolveProductionProfile = (
  name: ProductionProfileName = "compatibility",
): ProductionProfile => PRODUCTION_PROFILES[name]
