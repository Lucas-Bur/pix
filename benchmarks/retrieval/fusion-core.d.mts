import type { QualitySummary } from "./types.js"
import type { EvaluationCandidate, EvaluationSnapshot } from "./worker-pool.js"

export function evaluatePreparedContributions(
  matrix: unknown,
  weights: unknown,
): {
  readonly chunkIndex: number
  readonly score: number
}[]

export function evaluateCandidate(
  snapshot: EvaluationSnapshot,
  candidate: EvaluationCandidate,
): QualitySummary
