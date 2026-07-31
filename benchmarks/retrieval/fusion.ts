import type { RankedChunk } from "../../src/domain/ports.js"
import { rrfFuse } from "../../src/lib/retrieval/rrf.js"
import type { ChannelName, ChannelRankings } from "./ranking.js"
import type { ChannelWeights, FusionMethod } from "./types.js"

const CHANNELS: readonly ChannelName[] = ["identity", "camelcase", "bm25", "dense"]
const DEFAULT_CANDIDATE_DEPTH = 200
const NEUTRAL_NORMALIZED_SCORE = 0.5

/** Fusion algorithms compared by the full benchmark profile. */
export const FUSION_METHODS: readonly FusionMethod[] = ["rrf", "relative-score", "dbsf"]

interface PreparedFusionRankings {
  readonly present: readonly ChannelName[]
  readonly lists: Readonly<Record<ChannelName, readonly RankedChunk[]>>
  readonly normalized: Readonly<Record<ChannelName, readonly number[]>>
}

const preparedCache = new WeakMap<ChannelRankings, Map<string, PreparedFusionRankings>>()

const relativeScores = (ranking: readonly RankedChunk[]): readonly number[] => {
  if (ranking.length === 0) return []
  const max = ranking[0].score
  const min = ranking[ranking.length - 1].score
  if (max === min) return ranking.map(() => NEUTRAL_NORMALIZED_SCORE)
  return ranking.map((entry) => (entry.score - min) / (max - min))
}

const distributionScores = (ranking: readonly RankedChunk[]): readonly number[] => {
  if (ranking.length <= 1) return ranking.map(() => NEUTRAL_NORMALIZED_SCORE)
  const mean = ranking.reduce((sum, entry) => sum + entry.score, 0) / ranking.length
  const variance =
    ranking.reduce((sum, entry) => sum + (entry.score - mean) ** 2, 0) / (ranking.length - 1)
  const standardDeviation = Math.sqrt(variance)
  if (standardDeviation === 0) return ranking.map(() => NEUTRAL_NORMALIZED_SCORE)
  const lowerBound = mean - 3 * standardDeviation
  return ranking.map((entry) => (entry.score - lowerBound) / (6 * standardDeviation))
}

const prepareFusionRankings = (
  method: FusionMethod,
  rankings: ChannelRankings,
  candidateDepth: number,
): PreparedFusionRankings => {
  const cacheKey = `${method}:${candidateDepth}`
  const cachedByKey = preparedCache.get(rankings)
  const cached = cachedByKey?.get(cacheKey)
  if (cached !== undefined) return cached

  const lists = {
    identity: rankings.identity.slice(0, candidateDepth),
    camelcase: rankings.camelcase.slice(0, candidateDepth),
    bm25: rankings.bm25.slice(0, candidateDepth),
    dense: rankings.dense.slice(0, candidateDepth),
  }
  const normalize =
    method === "relative-score" ? relativeScores : method === "dbsf" ? distributionScores : () => []
  const prepared: PreparedFusionRankings = {
    present: CHANNELS.filter((channel) => lists[channel].length > 0),
    lists,
    normalized: {
      identity: normalize(lists.identity),
      camelcase: normalize(lists.camelcase),
      bm25: normalize(lists.bm25),
      dense: normalize(lists.dense),
    },
  }
  const entries = cachedByKey ?? new Map<string, PreparedFusionRankings>()
  entries.set(cacheKey, prepared)
  if (cachedByKey === undefined) preparedCache.set(rankings, entries)
  return prepared
}

/** Fuse precomputed channel rankings with one positive weight vector and fusion algorithm. */
export const fuseRankings = (
  method: FusionMethod,
  rankings: ChannelRankings,
  weights: ChannelWeights,
  candidateDepth = DEFAULT_CANDIDATE_DEPTH,
): readonly RankedChunk[] => {
  const prepared = prepareFusionRankings(method, rankings, candidateDepth)
  const present = prepared.present.filter((channel) => weights[channel] > 0)
  const lists = present.map((channel) => prepared.lists[channel])
  if (method === "rrf")
    return rrfFuse(
      lists,
      present.map((channel) => weights[channel]),
    )

  const scores = new Map<number, number>()
  for (let channelIndex = 0; channelIndex < present.length; channelIndex++) {
    const channel = present[channelIndex]
    const ranking = lists[channelIndex]
    const normalized = prepared.normalized[channel]
    for (let rank = 0; rank < ranking.length; rank++) {
      const chunkIndex = ranking[rank].chunkIndex
      scores.set(chunkIndex, (scores.get(chunkIndex) ?? 0) + weights[channel] * normalized[rank])
    }
  }
  return [...scores]
    .map(([chunkIndex, score]) => ({ chunkIndex, score }))
    .sort((left, right) => right.score - left.score)
}
