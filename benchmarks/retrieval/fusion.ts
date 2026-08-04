import type { RankedChunk } from "../../src/domain/ports.js"
import {
  CHANNEL_NAMES,
  type ChannelName,
  type ChannelRankings,
  type ChannelWeights,
  type FusionMethod,
} from "../../src/domain/retrieval.js"
import { fuseRankings as productionFuseRankings } from "../../src/lib/retrieval/fusion.js"
import { evaluatePreparedContributions } from "./fusion-core.mjs"

const DEFAULT_CANDIDATE_DEPTH = Number.POSITIVE_INFINITY

/** Structured-cloneable contribution data shared with benchmark worker threads. */
export interface PreparedFusionSnapshot {
  readonly chunkIndices: readonly number[]
  readonly presence: Uint8Array
  readonly values: Readonly<Record<ChannelName, Float64Array>>
}

/** Reusable benchmark-only evaluator for one prepared ranking set and fusion method. */
export interface PreparedFusionEvaluator {
  readonly evaluate: (weights: ChannelWeights) => RankedChunk[]
  readonly snapshot: PreparedFusionSnapshot
}

const preparedEvaluators = new WeakMap<ChannelRankings, Map<string, PreparedFusionEvaluator>>()

const prepareContributionMatrix = (
  method: FusionMethod,
  rankings: ChannelRankings,
  candidateDepth: number,
): PreparedFusionSnapshot => {
  const positions = new Map<number, number>()
  const chunkIndices: number[] = []
  for (const channel of CHANNEL_NAMES) {
    for (const entry of rankings[channel].slice(0, candidateDepth)) {
      if (!positions.has(entry.chunkIndex)) {
        positions.set(entry.chunkIndex, chunkIndices.length)
        chunkIndices.push(entry.chunkIndex)
      }
    }
  }

  const presence = new Uint8Array(chunkIndices.length)
  const values: Record<ChannelName, Float64Array> = {
    identity: new Float64Array(chunkIndices.length),
    camelcase: new Float64Array(chunkIndices.length),
    bm25: new Float64Array(chunkIndices.length),
    dense: new Float64Array(chunkIndices.length),
    sparse: new Float64Array(chunkIndices.length),
  }

  for (let channelIndex = 0; channelIndex < CHANNEL_NAMES.length; channelIndex++) {
    const channel = CHANNEL_NAMES[channelIndex]
    const channelWeights: ChannelWeights = {
      identity: 0,
      camelcase: 0,
      bm25: 0,
      dense: 0,
      sparse: 0,
      [channel]: 1,
    }
    for (const entry of productionFuseRankings(method, rankings, channelWeights, candidateDepth)) {
      const position = positions.get(entry.chunkIndex)
      if (position === undefined) continue
      presence[position] |= 1 << channelIndex
      values[channel][position] = entry.score
    }
  }
  return { chunkIndices, presence, values }
}

/** Prepare benchmark-only per-chunk contributions for repeated serial evaluation. */
export const prepareFusion = (
  method: FusionMethod,
  rankings: ChannelRankings,
  candidateDepth = DEFAULT_CANDIDATE_DEPTH,
): PreparedFusionEvaluator => {
  const key = `${method}:${candidateDepth}`
  const cachedByKey = preparedEvaluators.get(rankings)
  const cached = cachedByKey?.get(key)
  if (cached !== undefined) return cached

  const matrix = prepareContributionMatrix(method, rankings, candidateDepth)
  const evaluator: PreparedFusionEvaluator = {
    evaluate: (weights) => evaluatePreparedContributions(matrix, weights),
    snapshot: matrix,
  }
  if (cachedByKey === undefined) preparedEvaluators.set(rankings, new Map([[key, evaluator]]))
  else cachedByKey.set(key, evaluator)
  return evaluator
}
