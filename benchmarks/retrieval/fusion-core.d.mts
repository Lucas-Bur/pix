import type { ChannelWeights } from "../../src/domain/retrieval.js"
import type { PreparedFusionSnapshot } from "./fusion.js"
import type { QualitySummary } from "./types.js"
import type { EvaluationCandidate, EvaluationSnapshot } from "./worker-pool.js"

export function evaluatePreparedContributions(
  matrix: PreparedFusionSnapshot,
  weights: ChannelWeights,
): {
  readonly chunkIndex: number
  readonly score: number
}[]

export function evaluateCandidate(
  snapshot: EvaluationSnapshot,
  candidate: EvaluationCandidate,
): QualitySummary
