import type { RankedChunk } from "../../domain/ports.js"
import {
  CHANNEL_NAMES,
  type ChannelName,
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

type NormalizedByChannel = Record<ChannelName, readonly number[]>

interface FusionWorkState {
  readonly chunkIndices: readonly number[]
  readonly positions: Record<ChannelName, readonly number[]>
  readonly scores: Float64Array
  readonly seen: Uint32Array
  readonly touched: Uint32Array
  generation: number
}

interface PreparedRankings {
  readonly lists: ChannelRankings
  readonly normalized: Partial<Record<"relative-score" | "dbsf", NormalizedByChannel>>
  readonly work: FusionWorkState
}

const preparedRankingsCache = new WeakMap<ChannelRankings, Map<number, PreparedRankings>>()

const prepareRankings = (rankings: ChannelRankings, candidateDepth: number): PreparedRankings => {
  const cachedByDepth = preparedRankingsCache.get(rankings)
  const cached = cachedByDepth?.get(candidateDepth)
  if (cached !== undefined) return cached

  const lists: ChannelRankings = {
    identity: rankings.identity.slice(0, candidateDepth),
    camelcase: rankings.camelcase.slice(0, candidateDepth),
    bm25: rankings.bm25.slice(0, candidateDepth),
    dense: rankings.dense.slice(0, candidateDepth),
    sparse: rankings.sparse.slice(0, candidateDepth),
  }
  const chunkPositions = new Map<number, number>()
  const chunkIndices: number[] = []
  const positionsFor = (channel: ChannelName): readonly number[] =>
    lists[channel].map((entry) => {
      const cachedPosition = chunkPositions.get(entry.chunkIndex)
      if (cachedPosition !== undefined) return cachedPosition
      const position = chunkIndices.length
      chunkPositions.set(entry.chunkIndex, position)
      chunkIndices.push(entry.chunkIndex)
      return position
    })

  const prepared: PreparedRankings = {
    lists,
    normalized: {},
    work: {
      chunkIndices,
      positions: {
        identity: positionsFor("identity"),
        camelcase: positionsFor("camelcase"),
        bm25: positionsFor("bm25"),
        dense: positionsFor("dense"),
        sparse: positionsFor("sparse"),
      },
      scores: new Float64Array(chunkIndices.length),
      seen: new Uint32Array(chunkIndices.length),
      touched: new Uint32Array(chunkIndices.length),
      generation: 0,
    },
  }
  if (cachedByDepth === undefined)
    preparedRankingsCache.set(rankings, new Map([[candidateDepth, prepared]]))
  else cachedByDepth.set(candidateDepth, prepared)
  return prepared
}

const normalizedRankings = (
  prepared: PreparedRankings,
  method: "relative-score" | "dbsf",
): NormalizedByChannel => {
  const cached = prepared.normalized[method]
  if (cached !== undefined) return cached
  const normalized: NormalizedByChannel = {
    identity: normalize(method, prepared.lists.identity),
    camelcase: normalize(method, prepared.lists.camelcase),
    bm25: normalize(method, prepared.lists.bm25),
    dense: normalize(method, prepared.lists.dense),
    sparse: normalize(method, prepared.lists.sparse),
  }
  prepared.normalized[method] = normalized
  return normalized
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
  const prepared = prepareRankings(rankings, candidateDepth)
  const lists = prepared.lists
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

  const normalized = normalizedRankings(prepared, method)
  const work = prepared.work
  work.generation++
  if (work.generation === 0xffffffff) {
    work.seen.fill(0)
    work.generation = 1
  }
  let touchedCount = 0
  for (const channel of present) {
    const ranking = lists[channel]
    const channelScores = normalized[channel]
    const positions = work.positions[channel]
    const channelWeight = weights[channel]
    for (let rank = 0; rank < ranking.length; rank++) {
      const position = positions[rank]
      if (work.seen[position] !== work.generation) {
        work.seen[position] = work.generation
        work.scores[position] = channelWeight * channelScores[rank]
        work.touched[touchedCount++] = position
      } else {
        work.scores[position] += channelWeight * channelScores[rank]
      }
    }
  }

  const entries: [number, number][] = []
  for (let index = 0; index < touchedCount; index++) {
    const position = work.touched[index]
    entries.push([work.chunkIndices[position], work.scores[position]])
  }
  return sortFused(entries)
}
