import type { RankedChunk } from "../../domain/ports.js"
import {
  CHANNEL_NAMES,
  type ChannelRankings,
  type ChannelWeights,
  type FusionMethod,
} from "../../domain/retrieval.js"
import { rrfFuse } from "./rrf.js"

const NEUTRAL_NORMALIZED_SCORE = 0.5
const DEFAULT_CANDIDATE_DEPTH = Number.POSITIVE_INFINITY

const clamp = (value: number): number => Math.max(0, Math.min(1, value))

const relativeScores = (ranking: readonly RankedChunk[]): readonly number[] => {
  if (ranking.length === 0) return []
  let max = ranking[0].score
  let min = ranking[0].score
  for (const entry of ranking) {
    if (entry.score > max) max = entry.score
    if (entry.score < min) min = entry.score
  }
  if (max === min) return ranking.map(() => NEUTRAL_NORMALIZED_SCORE)
  return ranking.map((entry) => clamp((entry.score - min) / (max - min)))
}

const distributionScores = (ranking: readonly RankedChunk[]): readonly number[] => {
  if (ranking.length <= 1) return ranking.map(() => NEUTRAL_NORMALIZED_SCORE)
  const mean = ranking.reduce((sum, entry) => sum + entry.score, 0) / ranking.length
  const variance =
    ranking.reduce((sum, entry) => sum + (entry.score - mean) ** 2, 0) / (ranking.length - 1)
  const standardDeviation = Math.sqrt(variance)
  if (standardDeviation === 0) return ranking.map(() => NEUTRAL_NORMALIZED_SCORE)
  const lowerBound = mean - 3 * standardDeviation
  return ranking.map((entry) => clamp((entry.score - lowerBound) / (6 * standardDeviation)))
}

const normalize = (method: FusionMethod, ranking: readonly RankedChunk[]): readonly number[] => {
  switch (method) {
    case "rrf":
      return []
    case "relative-score":
      return relativeScores(ranking)
    case "dbsf":
      return distributionScores(ranking)
  }
}

const sortFused = (entries: readonly [number, number][]): RankedChunk[] =>
  entries
    .map(([chunkIndex, score]) => ({ chunkIndex, score }))
    .sort((left, right) => right.score - left.score || left.chunkIndex - right.chunkIndex)

/** Fuse the five channel rankings with one validated weight vector and method. */
export const fuseRankings = (
  method: FusionMethod,
  rankings: ChannelRankings,
  weights: ChannelWeights,
  candidateDepth = DEFAULT_CANDIDATE_DEPTH,
): RankedChunk[] => {
  const lists = {
    identity: rankings.identity.slice(0, candidateDepth),
    camelcase: rankings.camelcase.slice(0, candidateDepth),
    bm25: rankings.bm25.slice(0, candidateDepth),
    dense: rankings.dense.slice(0, candidateDepth),
    sparse: rankings.sparse.slice(0, candidateDepth),
  }
  const present = CHANNEL_NAMES.filter(
    (channel) => lists[channel].length > 0 && weights[channel] > 0,
  )
  const selectedLists = present.map((channel) => lists[channel])

  if (method === "rrf") {
    return rrfFuse(
      selectedLists,
      present.map((channel) => weights[channel]),
    )
  }

  const scores = new Map<number, number>()
  for (let channelIndex = 0; channelIndex < present.length; channelIndex++) {
    const channel = present[channelIndex]
    const ranking = selectedLists[channelIndex]
    const normalized = normalize(method, ranking)
    for (let rank = 0; rank < ranking.length; rank++) {
      const chunkIndex = ranking[rank].chunkIndex
      const score = weights[channel] * normalized[rank]
      scores.set(chunkIndex, (scores.get(chunkIndex) ?? 0) + score)
    }
  }

  return sortFused([...scores])
}
