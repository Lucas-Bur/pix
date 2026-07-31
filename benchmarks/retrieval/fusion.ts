import type { RankedChunk } from "../../src/domain/ports.js"
import { rrfFuse } from "../../src/lib/retrieval/rrf.js"
import type { ChannelName, ChannelRankings } from "./ranking.js"
import type { ChannelWeights, FusionMethod } from "./types.js"

const CHANNELS: readonly ChannelName[] = ["identity", "camelcase", "bm25", "dense"]
const DEFAULT_CANDIDATE_DEPTH = 200
const NEUTRAL_NORMALIZED_SCORE = 0.5

/** Active fusion algorithms compared by current benchmark runs. */
export const FUSION_METHODS: readonly FusionMethod[] = ["relative-score", "dbsf"]

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

/** Fuse precomputed channel rankings with one positive weight vector and fusion algorithm. */
export const fuseRankings = (
  method: FusionMethod,
  rankings: ChannelRankings,
  weights: ChannelWeights,
  candidateDepth = DEFAULT_CANDIDATE_DEPTH,
): readonly RankedChunk[] => {
  const present = CHANNELS.filter((channel) => weights[channel] > 0 && rankings[channel].length > 0)
  const lists = present.map((channel) => rankings[channel].slice(0, candidateDepth))
  if (method === "rrf")
    return rrfFuse(
      lists,
      present.map((channel) => weights[channel]),
    )

  const scores = new Map<number, number>()
  for (let channelIndex = 0; channelIndex < present.length; channelIndex++) {
    const channel = present[channelIndex]
    const ranking = lists[channelIndex]
    const normalized =
      method === "relative-score" ? relativeScores(ranking) : distributionScores(ranking)
    for (let rank = 0; rank < ranking.length; rank++) {
      const chunkIndex = ranking[rank].chunkIndex
      scores.set(chunkIndex, (scores.get(chunkIndex) ?? 0) + weights[channel] * normalized[rank])
    }
  }
  return [...scores]
    .map(([chunkIndex, score]) => ({ chunkIndex, score }))
    .sort((left, right) => right.score - left.score)
}
