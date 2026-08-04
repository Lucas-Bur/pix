import {
  decodeEvidenceRouterConfig,
  ZERO_CHANNEL_COEFFICIENTS,
  type EvidenceRouterConfig,
} from "../../../src/domain/retrieval.js"

/** Historical RRF configuration used only for explicit benchmark and rollback comparisons. */
export const HISTORICAL_RRF_BASELINE_CONFIG: EvidenceRouterConfig = decodeEvidenceRouterConfig({
  fusion: "rrf",
  candidateDepth: 200,
  baseWeights: {
    identity: 3,
    camelcase: 1.5,
    bm25: 1,
    dense: 1,
    sparse: 1,
  },
  scoreInfluence: ZERO_CHANNEL_COEFFICIENTS,
  geometryInfluence: ZERO_CHANNEL_COEFFICIENTS,
  termCoverageInfluence: ZERO_CHANNEL_COEFFICIENTS,
  pairwiseAgreementInfluence: ZERO_CHANNEL_COEFFICIENTS,
  denseConfidenceInfluence: ZERO_CHANNEL_COEFFICIENTS,
  identifierInfluence: ZERO_CHANNEL_COEFFICIENTS,
  queryLengthInfluence: { ...ZERO_CHANNEL_COEFFICIENTS, bm25: -1, dense: 1 },
})
