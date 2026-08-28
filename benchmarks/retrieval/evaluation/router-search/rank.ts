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
import type {
  QualitySummary,
  RouterObjective,
  RouterSearchDiagnostics,
  RouterSearchStrategyName,
} from "../types.js"
import type { EvidenceSearchSample, WeightCandidate } from "../weight-search.js"
import {
  CHANNELS,
  SEARCH_BEAM_WIDTH,
  SEARCH_HALVING_KEEP_FACTOR,
  SEARCH_PROXY_PROMOTION_FACTOR,
  activeChannelsKey,
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

const buildRandomRouterSeeds = (
  baseSeed: EvidenceRouterConfig,
  parameters: readonly RouterParameter[],
  scoutCount: number,
): readonly EvidenceRouterConfig[] => {
  const points = SCOUT_SEQUENCES.random.points(scoutCount, parameters.length)
  return Array.from({ length: scoutCount }, (_, pointIndex) =>
    parameters.reduce(
      (config, parameter, parameterIndex) =>
        parameter.update(
          config,
          parameter.values[
            scoutLevelIndex(points[pointIndex]![parameterIndex]!, parameter.values.length)
          ]!,
        ),
      baseSeed,
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
  randomSearchMs: number
  beamSearchMs: number
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

/** Behavioral contract separating the router search strategies. */
export interface RouterSearchMode {
  readonly name: RouterSearchStrategyName
  /** Cheap-score survivors promoted per final beam slot. */
  readonly expansionFactor: number
  /** Whether proxy-vs-full rank agreement diagnostics are recorded. */
  readonly recordsProxyAgreement: boolean
  /** Whether the deterministic random-scout baseline comparison runs. */
  readonly runsRandomBaseline: boolean
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

export const PROXY_PROMOTION_MODE: RouterSearchMode = {
  name: "proxy-promotion",
  expansionFactor: SEARCH_PROXY_PROMOTION_FACTOR,
  recordsProxyAgreement: true,
  runsRandomBaseline: true,
  includesProfileSeed: true,
  compareStatic: (left, right, objective, baseline, profile) =>
    compareObjectiveQuality(left.quality, right.quality, objective, baseline, profile) ||
    activeChannelsKey(left.weights).localeCompare(activeChannelsKey(right.weights)),
  promoteProxy: (context, candidates, limit) => {
    const promoted = selectObjectiveCandidates(
      candidates,
      limit * SEARCH_PROXY_PROMOTION_FACTOR,
      context.proxyBaseline,
      context.profile,
    )
    return {
      promoted,
      agreementKeys: promoted.map((candidate) => routerKey(candidate.config)),
    }
  },
  orderRanked: (candidates) => candidates,
  selectElites: (context, candidates) =>
    selectObjectiveCandidates(candidates, SEARCH_BEAM_WIDTH, context.baseline, context.profile),
  selectBeam: (context, candidates, limit) =>
    selectObjectiveCandidates(candidates, limit, context.baseline, context.profile),
}

const HALVING_FUNNEL_MODE: RouterSearchMode = {
  name: "halving-funnel",
  expansionFactor: SEARCH_HALVING_KEEP_FACTOR,
  recordsProxyAgreement: false,
  runsRandomBaseline: false,
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

const ROUTER_SEARCH_MODES: Readonly<Record<RouterSearchStrategyName, RouterSearchMode>> = {
  "proxy-promotion": PROXY_PROMOTION_MODE,
  "halving-funnel": HALVING_FUNNEL_MODE,
}

export const resolveRouterSearchMode = (name: RouterSearchStrategyName): RouterSearchMode =>
  ROUTER_SEARCH_MODES[name]

export const selectRandomRouter = async (
  samples: readonly EvidenceSearchSample[],
  baseSeed: EvidenceRouterConfig,
  parameters: readonly RouterParameter[],
  pool: CandidateEvaluationPool,
  baseline: QualitySummary,
  profile: OptimizationProfile,
  stats: SearchEvaluationStats,
  scoutCount: number,
): Promise<{ readonly candidate: RouterCandidate; readonly candidates: number }> => {
  const configs = buildRandomRouterSeeds(baseSeed, parameters, scoutCount)
  const candidatePreparationStartedAt = performance.now()
  const evaluationCandidates = configs.map((config) => routerEvaluationCandidate(samples, config))
  stats.timings.candidatePreparationMs += performance.now() - candidatePreparationStartedAt
  const candidateEvaluationStartedAt = performance.now()
  const qualities = await pool.evaluate(evaluationCandidates)
  stats.timings.candidateEvaluationMs += performance.now() - candidateEvaluationStartedAt
  const candidates: RouterCandidate[] = []
  for (let index = 0; index < configs.length; index++) {
    const config = configs[index]
    const quality = qualities[index]
    if (config === undefined || quality === undefined)
      throw new Error("Candidate evaluation returned an incomplete random router result")
    candidates.push({ config, quality })
  }
  const candidate = [...candidates].sort((left, right) =>
    compareRouterCandidates(left, right, "reranker-top20", baseline, profile),
  )[0]
  if (candidate === undefined)
    throw new Error("Candidate evaluation produced no random router candidate")
  return { candidate, candidates: candidates.length }
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

const finalizeRouterCandidates = (
  context: RouterSearchContext,
  rankedFull: readonly RouterCandidate[],
  proxyKeys: readonly string[],
  limit: number,
): readonly RouterCandidate[] => {
  if (context.mode.recordsProxyAgreement && proxyKeys.length > 0) {
    const fullRanks = new Map(
      rankedFull.map((candidate, rank) => [routerKey(candidate.config), rank]),
    )
    for (let left = 0; left < proxyKeys.length; left++) {
      const leftRank = fullRanks.get(proxyKeys[left])
      if (leftRank === undefined) continue
      for (let right = left + 1; right < proxyKeys.length; right++) {
        const rightRank = fullRanks.get(proxyKeys[right])
        if (rightRank === undefined) continue
        context.stats.proxyAgreementComparisons++
        if (leftRank < rightRank) context.stats.proxyAgreementMatches++
      }
    }
  }
  const ordered = context.mode.orderRanked(rankedFull)
  for (const candidate of ordered) context.archive.set(routerKey(candidate.config), candidate)
  const elites = context.mode.selectElites(context, [...context.elites.values(), ...ordered])
  context.elites.clear()
  for (const candidate of elites) context.elites.set(routerKey(candidate.config), candidate)
  return context.mode.selectBeam(context, ordered, limit)
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

export const rankRouterCandidates = async (
  context: RouterSearchContext,
  configs: readonly EvidenceRouterConfig[],
  limit: number,
  protectedConfigs: readonly EvidenceRouterConfig[] = [],
  useProxy = true,
): Promise<readonly RouterCandidate[]> => {
  const unique = new Map<string, EvidenceRouterConfig>()
  for (const config of configs) unique.set(routerKey(config), config)
  context.stats.rawCandidates += configs.length
  context.stats.uniqueCandidates += unique.size
  context.stats.protectedEliteCount += protectedConfigs.length + context.elites.size
  let fullCandidates = [...unique]
  let proxyKeys: readonly string[] = []
  if (useProxy && context.proxySamples.length < context.samples.length) {
    const rankedProxy = await evaluateRouterConfigs(
      fullCandidates,
      context.proxySamples,
      context.proxyPool,
      context.proxyQualityCache,
    )
    context.stats.proxyCacheHits += rankedProxy.cacheHits
    context.stats.proxyEvaluations += rankedProxy.evaluations
    context.stats.timings.candidatePreparationMs += rankedProxy.candidatePreparationMs
    context.stats.timings.candidateEvaluationMs += rankedProxy.candidateEvaluationMs
    const proxySelectionStartedAt = performance.now()
    const { promoted, agreementKeys } = context.mode.promoteProxy(
      context,
      rankedProxy.candidates,
      limit,
    )
    const selected = new Map(
      promoted.map((candidate) => [routerKey(candidate.config), candidate.config]),
    )
    context.stats.proxyPromotions += promoted.length
    const protectedKeys = new Set([...protectedConfigs.map(routerKey), ...context.elites.keys()])
    for (const [key, config] of fullCandidates) {
      if (protectedKeys.has(key)) selected.set(key, config)
    }
    fullCandidates = [...selected]
    proxyKeys = agreementKeys
    context.stats.timings.candidateSelectionMs += performance.now() - proxySelectionStartedAt
  }
  const rankedFull = await evaluateRouterConfigs(
    fullCandidates,
    context.samples,
    context.fullPool,
    context.qualityCache,
  )
  context.stats.fullCacheHits += rankedFull.cacheHits
  context.stats.fullEvaluations += rankedFull.evaluations
  context.stats.timings.candidatePreparationMs += rankedFull.candidatePreparationMs
  context.stats.timings.candidateEvaluationMs += rankedFull.candidateEvaluationMs
  const fullSelectionStartedAt = performance.now()
  const selected = finalizeRouterCandidates(context, rankedFull.candidates, proxyKeys, limit)
  context.stats.timings.candidateSelectionMs += performance.now() - fullSelectionStartedAt
  return selected
}
