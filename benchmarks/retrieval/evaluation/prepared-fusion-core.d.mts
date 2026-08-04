import type { ChannelWeights } from "../../../src/domain/retrieval.js"
import type {
  EvaluationCandidate,
  EvaluationSnapshot,
} from "../execution/candidate-evaluation-pool.js"
import type { PreparedFusionSnapshot } from "./prepared-fusion.js"
import type { QualitySummary } from "./types.js"

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
