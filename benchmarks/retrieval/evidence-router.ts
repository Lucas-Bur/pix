import type { IdentifierIndexMaps } from "../../src/domain/identifier-index.js"
import type { Bm25Index } from "../../src/domain/ports.js"
import { splitIdentifier } from "../../src/lib/parsing/split-identifier.js"
import { tokenize } from "../../src/lib/retrieval/tokenize.js"
import type { ChannelName, ChannelRankings } from "./ranking.js"
import type { ChannelWeights } from "./types.js"

const CHANNELS: readonly ChannelName[] = ["identity", "camelcase", "bm25", "dense"]
const SCORE_REFERENCE_RANK = 9
const AGREEMENT_SOURCE_DEPTH = 5
const AGREEMENT_TARGET_DEPTH = 20
const SCORE_GEOMETRY_DEPTH = 20

/** Query-term coverage measured independently for the lexical and identifier channels. */
export interface QueryTermCoverage {
  readonly bm25Idf: number
  readonly identity: number
  readonly camelcase: number
}

/** Normalized shape measurements derived from one channel's top score curve. */
export interface ScoreGeometryEvidence {
  readonly top1Top2Gap: number
  readonly top1Top3Gap: number
  readonly top1Top10Gap: number
  readonly top3Top20Gap: number
  readonly areaUnderCurve: number
  readonly plateauWidth: number
  readonly entropy: number
  readonly effectiveCandidateCount: number
  readonly confidence: number
}

/** Scale-independent diagnostics derived from one channel's ranked results. */
export interface ChannelEvidence {
  readonly available: boolean
  readonly scoreSeparation: number
  readonly agreement: number
  readonly scoreGeometry: ScoreGeometryEvidence
  readonly termCoverage: number
}

/** Observable query and channel evidence available before score or rank fusion. */
export interface RoutingEvidence {
  readonly tokenCount: number
  readonly identifierLikelihood: number
  readonly queryLengthSignal: number
  readonly termCoverage: QueryTermCoverage
  readonly channels: Readonly<Record<ChannelName, ChannelEvidence>>
}

/** Interpretable parameters controlling evidence-based channel weighting. */
export interface EvidenceRouterConfig {
  readonly baseWeights: ChannelWeights
  readonly scoreInfluence: ChannelCoefficients
  readonly geometryInfluence: ChannelCoefficients
  readonly termCoverageInfluence: ChannelCoefficients
  readonly agreementInfluence: ChannelCoefficients
  readonly identifierInfluence: ChannelCoefficients
  readonly queryLengthInfluence: ChannelCoefficients
}

/** Per-channel coefficient vector; query interactions may use negative values. */
export interface ChannelCoefficients {
  readonly identity: number
  readonly camelcase: number
  readonly bm25: number
  readonly dense: number
}

const clamp = (value: number): number => Math.max(0, Math.min(1, value))

const ZERO_TERM_COVERAGE: QueryTermCoverage = { bm25Idf: 0, identity: 0, camelcase: 0 }

const idf = (documentCount: number, documentFrequency: number): number =>
  Math.log(1 + (documentCount - documentFrequency + 0.5) / (documentFrequency + 0.5))

/** Build query-term coverage signals from the same indexes used by the retrieval channels. */
export const buildQueryTermCoverage = (
  query: string,
  bm25Index: Bm25Index,
  identifierIndex: IdentifierIndexMaps,
): QueryTermCoverage => {
  const terms = [...new Set(tokenize(query))]
  if (terms.length === 0) return ZERO_TERM_COVERAGE

  const documentCount = bm25Index.chunkLengths.length
  const totalIdf = terms.reduce(
    (sum, term) => sum + idf(documentCount, bm25Index.docFreqs[term] ?? 0),
    0,
  )
  const coveredIdf = terms.reduce(
    (sum, term) =>
      sum +
      (bm25Index.docFreqs[term] === undefined ? 0 : idf(documentCount, bm25Index.docFreqs[term])),
    0,
  )
  const camelcaseTerms = [...new Set(splitIdentifier(query))]
  const coveredCamelcaseTerms = camelcaseTerms.filter(
    (term) => (identifierIndex.split[term]?.length ?? 0) > 0,
  ).length

  return {
    bm25Idf: totalIdf === 0 ? 0 : coveredIdf / totalIdf,
    identity: identifierIndex.exact[query.toLowerCase()] === undefined ? 0 : 1,
    camelcase: camelcaseTerms.length === 0 ? 0 : coveredCamelcaseTerms / camelcaseTerms.length,
  }
}

const scoreSeparation = (ranking: ChannelRankings[ChannelName]): number => {
  if (ranking.length === 0) return 0
  if (ranking.length === 1) return 1
  const top = ranking[0].score
  const reference = ranking[Math.min(SCORE_REFERENCE_RANK, ranking.length - 1)].score
  return clamp((top - reference) / (Math.abs(top) + Math.abs(reference) + Number.EPSILON))
}

const normalizedGap = (top: number, reference: number): number =>
  clamp((top - reference) / (Math.abs(top) + Math.abs(reference) + Number.EPSILON))

const scoreGeometry = (ranking: ChannelRankings[ChannelName]): ScoreGeometryEvidence => {
  if (ranking.length === 0)
    return {
      top1Top2Gap: 0,
      top1Top3Gap: 0,
      top1Top10Gap: 0,
      top3Top20Gap: 0,
      areaUnderCurve: 0,
      plateauWidth: 0,
      entropy: 0,
      effectiveCandidateCount: 0,
      confidence: 0,
    }
  if (ranking.length === 1)
    return {
      top1Top2Gap: 1,
      top1Top3Gap: 1,
      top1Top10Gap: 1,
      top3Top20Gap: 1,
      areaUnderCurve: 1,
      plateauWidth: 0,
      entropy: 0,
      effectiveCandidateCount: 0,
      confidence: 1,
    }

  const scores = ranking.slice(0, SCORE_GEOMETRY_DEPTH).map((entry) => entry.score)
  const top = scores[0]
  const last = scores[scores.length - 1]
  const range = top - last
  const normalized =
    range === 0 ? scores.map(() => 1) : scores.map((score) => (score - last) / range)
  const areaUnderCurve = normalized.reduce((sum, score) => sum + score, 0) / normalized.length
  const plateauWidth = normalized.filter((score) => score >= 0.9).length / normalized.length
  const total = normalized.reduce((sum, score) => sum + score, 0)
  const probabilities =
    total === 0
      ? normalized.map(() => 1 / normalized.length)
      : normalized.map((score) => score / total)
  const entropyDenominator = Math.log(probabilities.length)
  const entropy =
    entropyDenominator === 0
      ? 0
      : -probabilities
          .filter((probability) => probability > 0)
          .reduce((sum, probability) => sum + probability * Math.log(probability), 0) /
        entropyDenominator
  const effectiveCount = 1 / probabilities.reduce((sum, probability) => sum + probability ** 2, 0)
  const effectiveCandidateCount = (effectiveCount - 1) / Math.max(1, probabilities.length - 1)
  const top1Top2Gap = normalizedGap(scores[0], scores[Math.min(1, scores.length - 1)])
  const top1Top3Gap = normalizedGap(scores[0], scores[Math.min(2, scores.length - 1)])
  const top1Top10Gap = normalizedGap(scores[0], scores[Math.min(9, scores.length - 1)])
  const top3Top20Gap = normalizedGap(
    scores[Math.min(2, scores.length - 1)],
    scores[Math.min(19, scores.length - 1)],
  )
  const gapConfidence = (top1Top2Gap + top1Top3Gap + top1Top10Gap + top3Top20Gap) / 4
  const concentrationConfidence =
    (1 - areaUnderCurve + 1 - plateauWidth + 1 - entropy + 1 - effectiveCandidateCount) / 4

  return {
    top1Top2Gap,
    top1Top3Gap,
    top1Top10Gap,
    top3Top20Gap,
    areaUnderCurve,
    plateauWidth,
    entropy,
    effectiveCandidateCount,
    confidence: clamp((gapConfidence + concentrationConfidence) / 2),
  }
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
export const buildRoutingEvidence = (
  query: string,
  rankings: ChannelRankings,
  termCoverage: QueryTermCoverage = ZERO_TERM_COVERAGE,
): RoutingEvidence => {
  const tokenCount = tokenize(query).length
  const identifierLikelihood = query !== "" && !/\s/u.test(query) ? 1 : 0
  const channelTermCoverage = (channel: ChannelName): number => {
    switch (channel) {
      case "identity":
        return termCoverage.identity
      case "camelcase":
        return termCoverage.camelcase
      case "bm25":
        return termCoverage.bm25Idf
      case "dense":
        return 0.5
    }
  }
  const channelEvidence = (channel: ChannelName): ChannelEvidence => ({
    available: rankings[channel].length > 0,
    scoreSeparation: scoreSeparation(rankings[channel]),
    agreement: channelAgreement(channel, rankings),
    scoreGeometry: scoreGeometry(rankings[channel]),
    termCoverage: channelTermCoverage(channel),
  })
  return {
    tokenCount,
    identifierLikelihood,
    queryLengthSignal: clamp((tokenCount - 2) / 6),
    termCoverage,
    channels: {
      identity: channelEvidence("identity"),
      camelcase: channelEvidence("camelcase"),
      bm25: channelEvidence("bm25"),
      dense: channelEvidence("dense"),
    },
  }
}

/** Calculate per-query fusion weights from observable evidence and an interpretable router config. */
export const routeWithEvidence = (
  evidence: RoutingEvidence,
  config: EvidenceRouterConfig,
): ChannelWeights => {
  const weight = (channel: ChannelName): number => {
    const channelEvidence = evidence.channels[channel]
    if (!channelEvidence.available) return 0
    const scoreFactor =
      1 - config.scoreInfluence[channel] * (1 - channelEvidence.scoreSeparation) * 0.75
    const agreementFactor =
      1 - config.agreementInfluence[channel] * (1 - channelEvidence.agreement) * 0.5
    const geometryFactor =
      1 +
      config.geometryInfluence[channel] * (2 * channelEvidence.scoreGeometry.confidence - 1) * 0.5
    const termCoverageFactor =
      1 + config.termCoverageInfluence[channel] * (2 * channelEvidence.termCoverage - 1) * 0.5
    const identifierFactor =
      1 + config.identifierInfluence[channel] * (2 * evidence.identifierLikelihood - 1) * 0.5
    const lengthFactor =
      1 + config.queryLengthInfluence[channel] * (2 * evidence.queryLengthSignal - 1) * 0.5
    return (
      config.baseWeights[channel] *
      scoreFactor *
      geometryFactor *
      termCoverageFactor *
      agreementFactor *
      identifierFactor *
      lengthFactor
    )
  }

  return {
    identity: weight("identity"),
    camelcase: weight("camelcase"),
    bm25: weight("bm25"),
    dense: weight("dense"),
  }
}
