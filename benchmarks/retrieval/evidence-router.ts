import { tokenize } from "../../src/lib/retrieval/tokenize.js"
import type { ChannelName, ChannelRankings } from "./ranking.js"
import type { ChannelWeights } from "./types.js"

const CHANNELS: readonly ChannelName[] = ["identity", "camelcase", "bm25", "dense"]
const SCORE_REFERENCE_RANK = 9
const AGREEMENT_SOURCE_DEPTH = 5
const AGREEMENT_TARGET_DEPTH = 20
const MAX_ABS_LOG2_ADJUSTMENT = 2

/** Scale-independent diagnostics derived from one channel's ranked results. */
export interface ChannelEvidence {
  readonly available: boolean
  readonly scoreSeparation: number
  readonly agreement: number
}

/** Observable query and channel evidence available before RRF fusion. */
export interface RoutingEvidence {
  readonly tokenCount: number
  readonly identifierLikelihood: number
  readonly queryLengthSignal: number
  readonly channels: Readonly<Record<ChannelName, ChannelEvidence>>
}

/** Interpretable parameters controlling evidence-based channel weighting. */
export interface EvidenceRouterConfig {
  readonly baseWeights: ChannelWeights
  readonly scoreCoefficient: ChannelCoefficients
  readonly agreementCoefficient: ChannelCoefficients
  readonly identifierCoefficient: ChannelCoefficients
  readonly queryLengthCoefficient: ChannelCoefficients
}

/** Per-channel coefficient vector; query interactions may use negative values. */
export interface ChannelCoefficients {
  readonly identity: number
  readonly camelcase: number
  readonly bm25: number
  readonly dense: number
}

const clamp = (value: number): number => Math.max(0, Math.min(1, value))

const scoreSeparation = (ranking: ChannelRankings[ChannelName]): number => {
  if (ranking.length === 0) return 0
  if (ranking.length === 1) return 1
  const top = ranking[0].score
  const reference = ranking[Math.min(SCORE_REFERENCE_RANK, ranking.length - 1)].score
  return clamp((top - reference) / (Math.abs(top) + Math.abs(reference) + Number.EPSILON))
}

const channelAgreement = (channel: ChannelName, rankings: ChannelRankings): number => {
  const source = rankings[channel].slice(0, AGREEMENT_SOURCE_DEPTH)
  if (source.length === 0) return 0
  const peers = CHANNELS.filter((candidate) => candidate !== channel).map((candidate) =>
    rankings[candidate].slice(0, AGREEMENT_TARGET_DEPTH),
  )
  let possible = 0
  let agreement = 0
  for (let sourceRank = 0; sourceRank < source.length; sourceRank++) {
    const sourceWeight = 1 / (sourceRank + 1)
    possible += sourceWeight
    let bestPeerRank: number | null = null
    for (const peer of peers) {
      const peerRank = peer.findIndex((entry) => entry.chunkIndex === source[sourceRank].chunkIndex)
      if (peerRank >= 0 && (bestPeerRank === null || peerRank < bestPeerRank))
        bestPeerRank = peerRank
    }
    if (bestPeerRank !== null) agreement += sourceWeight / (bestPeerRank + 1)
  }
  return possible === 0 ? 0 : agreement / possible
}

/** Derive scale-independent confidence and agreement signals from one query's channel rankings. */
export const buildRoutingEvidence = (query: string, rankings: ChannelRankings): RoutingEvidence => {
  const tokenCount = tokenize(query).length
  const identifierLikelihood = query !== "" && !/\s/u.test(query) ? 1 : 0
  const channelEvidence = (channel: ChannelName): ChannelEvidence => ({
    available: rankings[channel].length > 0,
    scoreSeparation: scoreSeparation(rankings[channel]),
    agreement: channelAgreement(channel, rankings),
  })
  return {
    tokenCount,
    identifierLikelihood,
    queryLengthSignal: clamp((tokenCount - 2) / 6),
    channels: {
      identity: channelEvidence("identity"),
      camelcase: channelEvidence("camelcase"),
      bm25: channelEvidence("bm25"),
      dense: channelEvidence("dense"),
    },
  }
}

/** Calculate per-query RRF weights from observable evidence and an interpretable router config. */
export const routeWithEvidence = (
  evidence: RoutingEvidence,
  config: EvidenceRouterConfig,
): ChannelWeights => {
  const weight = (channel: ChannelName): number => {
    const channelEvidence = evidence.channels[channel]
    if (!channelEvidence.available) return 0
    const combinedEvidence =
      config.scoreCoefficient[channel] * (2 * channelEvidence.scoreSeparation - 1) +
      config.agreementCoefficient[channel] * (2 * channelEvidence.agreement - 1) +
      config.identifierCoefficient[channel] * (2 * evidence.identifierLikelihood - 1) +
      config.queryLengthCoefficient[channel] * (2 * evidence.queryLengthSignal - 1)
    const boundedEvidence = Math.max(
      -MAX_ABS_LOG2_ADJUSTMENT,
      Math.min(MAX_ABS_LOG2_ADJUSTMENT, combinedEvidence),
    )
    return config.baseWeights[channel] * 2 ** boundedEvidence
  }

  return {
    identity: weight("identity"),
    camelcase: weight("camelcase"),
    bm25: weight("bm25"),
    dense: weight("dense"),
  }
}
