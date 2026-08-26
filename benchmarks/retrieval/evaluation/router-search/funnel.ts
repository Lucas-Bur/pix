import type { EvidenceRouterParameters as EvidenceRouterConfig } from "../../../../src/domain/retrieval.js"
import type { ScoutSequenceName } from "../scouts/index.js"
import {
  SEARCH_FUNNEL_FINALISTS,
  SEARCH_FUNNEL_SPREAD_SURVIVORS,
  routerKey,
  type RouterCandidate,
  type RouterParameter,
} from "./config-space.js"
import { buildLocalCloudConfigs } from "./local-cloud.js"
import {
  buildGlobalRouterSeeds,
  buildHypothesisRouterSeeds,
  evaluateRouterConfigs,
  selectObjectiveCandidates,
  type RouterSearchContext,
  type RouterEvaluationResult,
} from "./rank.js"

const uniqueConfigs = (
  configs: readonly EvidenceRouterConfig[],
): readonly (readonly [string, EvidenceRouterConfig])[] => {
  const unique = new Map<string, EvidenceRouterConfig>()
  for (const config of configs) unique.set(routerKey(config), config)
  return [...unique]
}

const recordEvaluation = (
  context: RouterSearchContext,
  result: RouterEvaluationResult,
  fidelity: "proxy" | "full",
): void => {
  if (fidelity === "proxy") {
    context.stats.proxyCacheHits += result.cacheHits
    context.stats.proxyEvaluations += result.evaluations
  } else {
    context.stats.fullCacheHits += result.cacheHits
    context.stats.fullEvaluations += result.evaluations
  }
  context.stats.timings.candidatePreparationMs += result.candidatePreparationMs
  context.stats.timings.candidateEvaluationMs += result.candidateEvaluationMs
}

const evaluateWave = async (
  context: RouterSearchContext,
  configs: readonly EvidenceRouterConfig[],
  fidelity: "proxy" | "full",
): Promise<readonly RouterCandidate[]> => {
  const entries = uniqueConfigs(configs)
  context.stats.rawCandidates += configs.length
  context.stats.uniqueCandidates += entries.length
  const result =
    fidelity === "proxy"
      ? await evaluateRouterConfigs(
          entries,
          context.proxySamples,
          context.proxyPool,
          context.proxyQualityCache,
        )
      : await evaluateRouterConfigs(
          entries,
          context.samples,
          context.fullPool,
          context.qualityCache,
        )
  recordEvaluation(context, result, fidelity)
  return result.candidates
}

/**
 * Run a two-wave fidelity funnel: broad scouts and corner hypotheses are proxy-scored, 32
 * objective-diverse survivors seed a proxy-scored local cloud, and only 256 diverse cloud finalists
 * plus the trusted base seeds receive full-fidelity evaluation. The returned candidates are the
 * complete full-quality archive.
 */
export const runHalvingFunnel = async (
  context: RouterSearchContext,
  baseSeeds: readonly EvidenceRouterConfig[],
  parameters: readonly RouterParameter[],
  scoutSequence: ScoutSequenceName,
  scoutCount: number,
  seedHypotheses: boolean,
  cloudPointsPerSurvivor: number,
  cloudRadiusLevels: number,
): Promise<readonly RouterCandidate[]> => {
  const spread = [
    ...baseSeeds,
    ...buildGlobalRouterSeeds(baseSeeds, parameters, scoutSequence, scoutCount),
    ...(seedHypotheses ? buildHypothesisRouterSeeds(baseSeeds, parameters) : []),
  ]
  const spreadScored = await evaluateWave(context, spread, "proxy")
  const spreadSurvivors = selectObjectiveCandidates(
    spreadScored,
    SEARCH_FUNNEL_SPREAD_SURVIVORS,
    context.proxyBaseline,
    context.profile,
  )
  context.stats.proxyPromotions += spreadSurvivors.length

  const cloudConfigs =
    cloudPointsPerSurvivor > 0 && cloudRadiusLevels > 0
      ? buildLocalCloudConfigs(
          spreadSurvivors.map(({ config }) => config),
          parameters,
          cloudPointsPerSurvivor,
          cloudRadiusLevels,
        )
      : []
  context.stats.localCloudCandidates += cloudConfigs.length
  const cloudScored = await evaluateWave(
    context,
    [...spreadSurvivors.map(({ config }) => config), ...cloudConfigs],
    "proxy",
  )
  const finalists = selectObjectiveCandidates(
    cloudScored,
    SEARCH_FUNNEL_FINALISTS,
    context.proxyBaseline,
    context.profile,
  )
  context.stats.proxyPromotions += finalists.length
  context.stats.protectedEliteCount += baseSeeds.length

  const fullScored = await evaluateWave(
    context,
    [...baseSeeds, ...finalists.map(({ config }) => config)],
    "full",
  )
  const ordered = context.mode.orderRanked(fullScored)
  for (const candidate of ordered) context.archive.set(routerKey(candidate.config), candidate)
  return ordered
}
