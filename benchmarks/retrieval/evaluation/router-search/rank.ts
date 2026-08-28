import type {
  EvidenceRouterParameters as EvidenceRouterConfig,
  FusionMethod,
} from "../../../../src/domain/retrieval.js"
import { routeWithEvidence } from "../../../../src/lib/retrieval/evidence-router.js"
import type {
  CandidateEvaluationPool,
  EvaluationCandidate,
} from "../../execution/candidate-evaluation-pool.js"
import type { OptimizationProfile } from "../optimization-profiles.js"
import { SCOUT_SEQUENCES, scoutLevelIndex, type ScoutSequenceName } from "../scouts/index.js"
import type { QualitySummary, RouterObjective, RouterSearchDiagnostics } from "../types.js"
import type { EvidenceSearchSample, WeightCandidate } from "../weight-search.js"
import {
  CHANNELS,
  SEARCH_BEAM_WIDTH,
  SEARCH_HALVING_KEEP_FACTOR,
  routerComplexity,
  routerKey,
  type RouterCandidate,
  type RouterParameter,
} from "./config-space.js"
import {
  SEARCH_OBJECTIVES,
  compareObjectiveQuality,
  compareSuccessiveHalvingQuality,
} from "./objectives.js"

const routerEvaluationCandidate = (
  samples: readonly EvidenceSearchSample[],
  config: EvidenceRouterConfig,
): EvaluationCandidate => ({
  weights: samples.map(({ evidence }) => routeWithEvidence(evidence, config)),
})

export const storeQualityResults = (
  pending: readonly (readonly [string, unknown])[],
  qualities: readonly QualitySummary[],
  qualityCache: Map<string, QualitySummary>,
  errorMessage: string,
): void => {
  for (let index = 0; index < pending.length; index++) {
    const entry = pending[index]
    const quality = qualities[index]
    if (entry === undefined || quality === undefined) throw new Error(errorMessage)
    qualityCache.set(entry[0], quality)
  }
}
export const buildSearchDiagnostics = (
  parameters: readonly RouterParameter[],
  stats: SearchEvaluationStats,
): RouterSearchDiagnostics => ({
  parameterCount: parameters.length,
  parameterLevels: Object.fromEntries(
    parameters.map((parameter) => [parameter.name, parameter.values]),
  ),
  rawCandidates: stats.rawCandidates,
  uniqueCandidates: stats.uniqueCandidates,
  proxyEvaluations: stats.proxyEvaluations,
  fullEvaluations: stats.fullEvaluations,
  proxyCacheHits: stats.proxyCacheHits,
  fullCacheHits: stats.fullCacheHits,
  proxyPromotions: stats.proxyPromotions,
  proxyFullAgreement:
    stats.proxyAgreementComparisons === 0
      ? 1
      : stats.proxyAgreementMatches / stats.proxyAgreementComparisons,
  protectedEliteCount: stats.protectedEliteCount,
  localCloudCandidates: stats.localCloudCandidates,
  timings: { ...stats.timings },
})

export const buildGlobalRouterSeeds = (
  baseSeeds: readonly EvidenceRouterConfig[],
  parameters: readonly RouterParameter[],
  sequenceName: ScoutSequenceName,
  scoutCount: number,
): readonly EvidenceRouterConfig[] => {
  if (baseSeeds.length === 0) return []
  const coefficientParameters = parameters.slice(CHANNELS.length)
  const sequence = SCOUT_SEQUENCES[sequenceName]
  if (coefficientParameters.length > sequence.maxParameters) {
    throw new Error(
      `${sequence.name} scouts support at most ${sequence.maxParameters} parameters, got ${coefficientParameters.length}`,
    )
  }
  const points = sequence.points(scoutCount, coefficientParameters.length)
  return Array.from({ length: scoutCount }, (_, pointIndex) =>
    coefficientParameters.reduce(
      (config, parameter, parameterIndex) =>
        parameter.update(
          config,
          parameter.values[
            scoutLevelIndex(points[pointIndex]![parameterIndex]!, parameter.values.length)
          ]!,
        ),
      baseSeeds[pointIndex % baseSeeds.length]!,
    ),
  )
}

/**
 * Hand-authored corner hypotheses: every parameter at its lowest level except one at its highest
 * (one per parameter), plus the all-minimum and all-maximum corners.
 */
export const buildHypothesisRouterSeeds = (
  baseSeeds: readonly EvidenceRouterConfig[],
  parameters: readonly RouterParameter[],
): readonly EvidenceRouterConfig[] => {
  if (baseSeeds.length === 0) return []
  const baseSeed = baseSeeds[0]!
  const corner = (except: number | undefined): EvidenceRouterConfig =>
    parameters.reduce((config, parameter, index) => {
      const values = parameter.values
      return parameter.update(config, values[index === except ? values.length - 1 : 0]!)
    }, baseSeed)
  return [
    ...parameters.map((_, index) => corner(index)),
    corner(undefined),
    ...baseSeeds.map((seed) =>
      parameters.reduce(
        (config, parameter) =>
          parameter.update(config, parameter.values[parameter.values.length - 1]!),
        seed,
      ),
    ),
  ]
}
/** Beam width for one coordinate round: wide at first, halving towards the target width. */
export const beamWidthForRound = (round: number, totalRounds: number, beamWidth: number): number =>
  Math.max(beamWidth, beamWidth * 2 ** (totalRounds - 1 - round))

export interface SearchEvaluationStats {
  rawCandidates: number
  uniqueCandidates: number
  proxyEvaluations: number
  fullEvaluations: number
  proxyCacheHits: number
  fullCacheHits: number
  proxyPromotions: number
  proxyAgreementMatches: number
  proxyAgreementComparisons: number
  protectedEliteCount: number
  localCloudCandidates: number
  timings: MutableRouterSearchTimings
}

export interface MutableRouterSearchTimings {
  preparationMs: number
  candidatePoolInitializationMs: number
  baseWeightSearchMs: number
  funnelSearchMs: number
  candidatePreparationMs: number
  candidateEvaluationMs: number
  candidateSelectionMs: number
}

export interface RouterSearchContext {
  readonly mode: RouterSearchMode
  readonly samples: readonly EvidenceSearchSample[]
  readonly proxySamples: readonly EvidenceSearchSample[]
  readonly qualityCache: Map<string, QualitySummary>
  readonly proxyQualityCache: Map<string, QualitySummary>
  readonly elites: Map<string, RouterCandidate>
  readonly archive: Map<string, RouterCandidate>
  readonly baseline: QualitySummary
  readonly proxyBaseline: QualitySummary
  readonly fusion: FusionMethod
  readonly profile: OptimizationProfile
  readonly stats: SearchEvaluationStats
  readonly fullPool: CandidateEvaluationPool
  readonly proxyPool: CandidateEvaluationPool
}

const compareRouterCandidates = (
  left: RouterCandidate,
  right: RouterCandidate,
  objective: RouterObjective,
  baseline: QualitySummary,
  profile: OptimizationProfile,
): number =>
  compareObjectiveQuality(left.quality, right.quality, objective, baseline, profile) ||
  routerComplexity(left.config) - routerComplexity(right.config)

const compareSuccessiveHalvingCandidates = (
  left: RouterCandidate,
  right: RouterCandidate,
): number =>
  compareSuccessiveHalvingQuality(left.quality, right.quality) ||
  routerComplexity(left.config) - routerComplexity(right.config)

const selectSuccessiveHalvingCandidates = (
  candidates: readonly RouterCandidate[],
  limit: number,
): readonly RouterCandidate[] =>
  [...candidates].sort(compareSuccessiveHalvingCandidates).slice(0, limit)

/** Behavioral contract of the funnel search over the shared candidate evaluator. */
export interface RouterSearchMode {
  /** Cheap-score survivors promoted per final beam slot. */
  readonly expansionFactor: number
  /** Whether proxy-vs-full rank agreement diagnostics are recorded. */
  readonly recordsProxyAgreement: boolean
  /** Whether the beam starts from the optimization-profile configuration too. */
  readonly includesProfileSeed: boolean
  /** Deterministic ordering over scored static weight candidates. */
  compareStatic(
    left: WeightCandidate,
    right: WeightCandidate,
    objective: RouterObjective,
    baseline: QualitySummary | undefined,
    profile: OptimizationProfile,
  ): number
  /** Promote cheaply scored candidates into the full-quality evaluation set. */
  promoteProxy(
    context: RouterSearchContext,
    candidates: readonly RouterCandidate[],
    limit: number,
  ): { readonly promoted: readonly RouterCandidate[]; readonly agreementKeys: readonly string[] }
  /** Order freshly evaluated full-quality candidates before archiving. */
  orderRanked(candidates: readonly RouterCandidate[]): readonly RouterCandidate[]
  /** Select the protected elite beam from archived plus fresh full-quality candidates. */
  selectElites(
    context: RouterSearchContext,
    candidates: readonly RouterCandidate[],
  ): readonly RouterCandidate[]
  /** Cut the returned beam from the ordered full-quality candidates. */
  selectBeam(
    context: RouterSearchContext,
    candidates: readonly RouterCandidate[],
    limit: number,
  ): readonly RouterCandidate[]
}

export const HALVING_FUNNEL_MODE: RouterSearchMode = {
  expansionFactor: SEARCH_HALVING_KEEP_FACTOR,
  recordsProxyAgreement: false,
  includesProfileSeed: false,
  compareStatic: (left, right) => compareSuccessiveHalvingQuality(left.quality, right.quality),
  promoteProxy: (_context, candidates, limit) => ({
    promoted: selectSuccessiveHalvingCandidates(candidates, limit * SEARCH_HALVING_KEEP_FACTOR),
    agreementKeys: [],
  }),
  orderRanked: (candidates) => [...candidates].sort(compareSuccessiveHalvingCandidates),
  selectElites: (_context, candidates) =>
    selectSuccessiveHalvingCandidates(candidates, SEARCH_BEAM_WIDTH),
  selectBeam: (_context, candidates, limit) => candidates.slice(0, limit),
}

export const selectObjectiveCandidates = (
  candidates: readonly RouterCandidate[],
  limit: number,
  baseline: QualitySummary,
  profile: OptimizationProfile,
): readonly RouterCandidate[] => {
  const selected = new Map<string, RouterCandidate>()
  const perObjective = Math.max(1, Math.floor(limit / SEARCH_OBJECTIVES.length))
  for (const objective of SEARCH_OBJECTIVES) {
    const ranked = [...candidates]
      .sort((left, right) => compareRouterCandidates(left, right, objective, baseline, profile))
      .slice(0, perObjective)
    for (const candidate of ranked) selected.set(routerKey(candidate.config), candidate)
  }
  if (selected.size < limit) {
    const fallback = [...candidates].sort((left, right) =>
      compareRouterCandidates(left, right, "reranker-top20", baseline, profile),
    )
    for (const candidate of fallback) {
      selected.set(routerKey(candidate.config), candidate)
      if (selected.size >= limit) break
    }
  }
  return [...selected.values()].slice(0, limit)
}

export interface RouterEvaluationResult {
  readonly candidates: readonly RouterCandidate[]
  readonly cacheHits: number
  readonly evaluations: number
  readonly candidatePreparationMs: number
  readonly candidateEvaluationMs: number
}

export const evaluateRouterConfigs = async (
  entries: readonly (readonly [string, EvidenceRouterConfig])[],
  samples: readonly EvidenceSearchSample[],
  pool: CandidateEvaluationPool,
  qualityCache: Map<string, QualitySummary>,
): Promise<RouterEvaluationResult> => {
  const pending = entries.filter(([key]) => qualityCache.get(key) === undefined)
  const candidatePreparationStartedAt = performance.now()
  const evaluationCandidates = pending.map(([, config]) =>
    routerEvaluationCandidate(samples, config),
  )
  const candidatePreparationMs = performance.now() - candidatePreparationStartedAt
  const candidateEvaluationStartedAt = performance.now()
  const qualities = await pool.evaluate(evaluationCandidates)
  const candidateEvaluationMs = performance.now() - candidateEvaluationStartedAt
  storeQualityResults(
    pending,
    qualities,
    qualityCache,
    "Candidate evaluation returned an incomplete router result",
  )
  return {
    candidates: entries.map(([key, config]) => {
      const quality = qualityCache.get(key)
      if (quality === undefined) throw new Error(`Missing cached router quality for ${key}`)
      return { config, quality }
    }),
    cacheHits: entries.length - pending.length,
    evaluations: pending.length,
    candidatePreparationMs,
    candidateEvaluationMs,
  }
}
