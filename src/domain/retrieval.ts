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

/** Versioned, explainable production fusion and evidence-router configuration. */
export const EvidenceRouterConfigSchema = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  fusion: FusionMethodSchema,
  candidateDepth: PositiveInt,
  ...EvidenceRouterParameterFields,
})

/** Decoded production fusion and evidence-router configuration. */
export type EvidenceRouterConfig = typeof EvidenceRouterConfigSchema.Type

/** Router parameters independent of the selected fusion method and config metadata. */
export type EvidenceRouterParameters = typeof EvidenceRouterParametersSchema.Type

/** Decode and validate a versioned fusion/router configuration at a boundary. */
export const decodeEvidenceRouterConfig = (input: unknown): EvidenceRouterConfig =>
  Schema.decodeUnknownSync(EvidenceRouterConfigSchema)(input)

const ZERO_COEFFICIENTS: ChannelCoefficients = {
  identity: 0,
  camelcase: 0,
  bm25: 0,
  dense: 0,
  sparse: 0,
}

/**
 * Current production compatibility profile; RRF remains the default until a benchmark validates a
 * change.
 */
export const PRODUCTION_COMPATIBILITY_CONFIG = decodeEvidenceRouterConfig({
  schemaVersion: 1,
  fusion: "rrf",
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
  queryLengthInfluence: ZERO_COEFFICIENTS,
})
