import {
  CHANNEL_NAMES,
  type ChannelName,
  type ChannelWeights,
  type EvidenceRouterParameters,
} from "../../../../src/domain/retrieval.js"
import {
  routeWithEvidence,
  type RoutingEvidence,
} from "../../../../src/lib/retrieval/evidence-router.js"
import { SCOUT_SEQUENCES, scoutLevelIndex } from "../scouts/index.js"
import { routerComplexity, routerKey, type RouterParameter } from "./config-space.js"

/** Benchmark-only router formulation under comparison. */
export type RouterModel = "multiplicative" | "regularized-log-linear"

/** Derivative-free search procedure used for a router comparison. */
export type RouterFittingMethod =
  | "staged"
  | "alternating-block-coordinate"
  | "deterministic-restarts"
  | "local-search"

/** Router formulations included in the benchmark comparison. */
const ROUTER_MODELS: readonly RouterModel[] = ["multiplicative", "regularized-log-linear"]

/** Derivative-free fitting methods included in the benchmark comparison. */
const ROUTER_FITTING_METHODS: readonly RouterFittingMethod[] = [
  "staged",
  "alternating-block-coordinate",
  "deterministic-restarts",
  "local-search",
]

/** Observed usefulness of one router parameter on the development samples. */
export interface RouterDimensionDiagnostic {
  readonly name: string
  readonly status: "active" | "inactive" | "data-constant"
  readonly observedValues: number
}

/** Candidate score supplied by a development-only evaluator. */
export interface RouterComparisonScore {
  readonly mean: number
  readonly standardError: number
}

/** One fitted router and its development score. */
export interface RouterComparisonCandidate {
  readonly config: EvidenceRouterParameters
  readonly score: RouterComparisonScore
}

/** Search output with explicit heuristic and dimension-accounting metadata. */
export interface RouterComparisonResult {
  readonly model: RouterModel
  readonly method: RouterFittingMethod
  readonly optimalityClaim: "derivative-free-heuristic-no-global-optimality-claim"
  readonly dimensions: readonly RouterDimensionDiagnostic[]
  readonly evaluatedCandidates: number
  readonly selected: RouterComparisonCandidate
  readonly complexityAware: RouterComparisonCandidate
  readonly oneStandardError: RouterComparisonCandidate
}

/** Excluded-holdout scores computed only after development selection has finished. */
export interface RouterComparisonHoldoutResult {
  readonly model: RouterModel
  readonly method: RouterFittingMethod
  readonly selected: RouterComparisonScore
  readonly complexityAware: RouterComparisonScore
  readonly oneStandardError: RouterComparisonScore
}

/** Configuration for one bounded comparison search. */
export interface RouterComparisonSearchOptions {
  readonly model: RouterModel
  readonly method: RouterFittingMethod
  readonly seed: EvidenceRouterParameters
  readonly parameters: readonly RouterParameter[]
  readonly evidence: readonly RoutingEvidence[]
  readonly pruneInactive?: boolean
  readonly restarts?: number
  readonly passes?: number
  readonly complexityPenalty?: number
  readonly evaluateDevelopment: (
    configs: readonly EvidenceRouterParameters[],
  ) => Promise<readonly RouterComparisonScore[]>
}

const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.max(minimum, Math.min(maximum, value))

const centeredEvidence = (
  evidence: RoutingEvidence,
  parameter: string,
  channel: ChannelName,
): number => {
  const channelEvidence = evidence.channels[channel]
  if (!channelEvidence.available) return 0
  if (parameter === "scoreInfluence") return channelEvidence.scoreSeparation - 0.5
  if (parameter === "geometryInfluence") return channelEvidence.scoreGeometry.confidence - 0.5
  if (parameter === "termCoverageInfluence") return channelEvidence.termCoverage - 0.5
  if (parameter === "pairwiseAgreementInfluence") return channelEvidence.pairwiseAgreement - 0.5
  if (parameter === "denseConfidenceInfluence") return channelEvidence.denseConfidence - 0.5
  if (parameter === "identifierInfluence") return evidence.identifierLikelihood - 0.5
  if (parameter === "queryLengthInfluence") return evidence.queryLengthSignal - 0.5
  return 0
}

/** Route with either the production multiplicative model or a bounded log-linear comparison gate. */
export const routeWithComparisonModel = (
  model: RouterModel,
  evidence: RoutingEvidence,
  config: EvidenceRouterParameters,
): ChannelWeights => {
  if (model === "multiplicative") return routeWithEvidence(evidence, config)
  const weight = (channel: ChannelName): number => {
    if (!evidence.channels[channel].available) return 0
    const logAdjustment =
      config.scoreInfluence[channel] * centeredEvidence(evidence, "scoreInfluence", channel) +
      config.geometryInfluence[channel] * centeredEvidence(evidence, "geometryInfluence", channel) +
      config.termCoverageInfluence[channel] *
        centeredEvidence(evidence, "termCoverageInfluence", channel) +
      config.pairwiseAgreementInfluence[channel] *
        centeredEvidence(evidence, "pairwiseAgreementInfluence", channel) +
      config.denseConfidenceInfluence[channel] *
        centeredEvidence(evidence, "denseConfidenceInfluence", channel) +
      config.identifierInfluence[channel] *
        centeredEvidence(evidence, "identifierInfluence", channel) +
      config.queryLengthInfluence[channel] *
        centeredEvidence(evidence, "queryLengthInfluence", channel)
    return config.baseWeights[channel] * Math.exp(clamp(logAdjustment, -2, 2))
  }
  return {
    identity: weight("identity"),
    camelcase: weight("camelcase"),
    bm25: weight("bm25"),
    dense: weight("dense"),
    sparse: weight("sparse"),
  }
}

const observedParameterValues = (
  parameter: RouterParameter,
  evidence: readonly RoutingEvidence[],
): readonly number[] => {
  const [family, channelName] = parameter.name.split(".")
  const channel = CHANNEL_NAMES.find((candidate) => candidate === channelName)
  if (channel === undefined) return []
  if (family === "baseWeights")
    return evidence.map((sample) => (sample.channels[channel].available ? 1 : 0))
  return evidence.map((sample) => centeredEvidence(sample, family ?? "", channel))
}

/** Classify search dimensions from development evidence without consulting holdout quality. */
export const classifyRouterDimensions = (
  parameters: readonly RouterParameter[],
  evidence: readonly RoutingEvidence[],
): readonly RouterDimensionDiagnostic[] =>
  parameters.map((parameter) => {
    const values = observedParameterValues(parameter, evidence)
    const distinct = new Set(values.map((value) => value.toFixed(8))).size
    return {
      name: parameter.name,
      status: values.every((value) => value === 0)
        ? "inactive"
        : distinct === 1
          ? "data-constant"
          : "active",
      observedValues: distinct,
    }
  })

const compareCandidates = (
  left: RouterComparisonCandidate,
  right: RouterComparisonCandidate,
): number =>
  right.score.mean - left.score.mean ||
  routerComplexity(left.config) - routerComplexity(right.config)

/** Select the highest regularized utility, penalizing non-zero router complexity. */
export const selectComplexityAwareCandidate = (
  candidates: readonly RouterComparisonCandidate[],
  penalty: number,
): RouterComparisonCandidate => {
  const selected = [...candidates].sort(
    (left, right) =>
      right.score.mean -
        penalty * routerComplexity(right.config) -
        (left.score.mean - penalty * routerComplexity(left.config)) ||
      routerComplexity(left.config) - routerComplexity(right.config),
  )[0]
  if (selected === undefined) throw new Error("Router comparison has no candidate")
  return selected
}

/** Select the simplest candidate within one standard error of the best development mean. */
export const selectOneStandardErrorCandidate = (
  candidates: readonly RouterComparisonCandidate[],
): RouterComparisonCandidate => {
  const best = [...candidates].sort(compareCandidates)[0]
  if (best === undefined) throw new Error("Router comparison has no candidate")
  const threshold = best.score.mean - best.score.standardError
  return [...candidates]
    .filter((candidate) => candidate.score.mean >= threshold)
    .sort(
      (left, right) =>
        routerComplexity(left.config) - routerComplexity(right.config) ||
        compareCandidates(left, right),
    )[0]!
}

const evaluate = async (
  configs: readonly EvidenceRouterParameters[],
  evaluateDevelopment: RouterComparisonSearchOptions["evaluateDevelopment"],
): Promise<readonly RouterComparisonCandidate[]> => {
  const unique = [...new Map(configs.map((config) => [routerKey(config), config])).values()]
  const scores = await evaluateDevelopment(unique)
  if (scores.length !== unique.length)
    throw new Error("Router comparison evaluator returned the wrong score count")
  return unique.map((config, index) => ({ config, score: scores[index]! }))
}

const improve = async (
  seed: RouterComparisonCandidate,
  parameters: readonly RouterParameter[],
  evaluateDevelopment: RouterComparisonSearchOptions["evaluateDevelopment"],
): Promise<{ readonly selected: RouterComparisonCandidate; readonly evaluations: number }> => {
  const candidates = await evaluate(
    [
      seed.config,
      ...parameters.flatMap((parameter) =>
        parameter.values.map((value) => parameter.update(seed.config, value)),
      ),
    ],
    evaluateDevelopment,
  )
  return { selected: [...candidates].sort(compareCandidates)[0]!, evaluations: candidates.length }
}

const parameterBlocks = (parameters: readonly RouterParameter[]): readonly RouterParameter[][] => {
  const blocks = new Map<string, RouterParameter[]>()
  for (const parameter of parameters) {
    const family = parameter.name.split(".")[0] ?? parameter.name
    const block = blocks.get(family) ?? []
    block.push(parameter)
    blocks.set(family, block)
  }
  return [...blocks.values()]
}

/** Run one bounded deterministic comparison search using development scores only. */
export const searchRouterComparison = async (
  options: RouterComparisonSearchOptions,
): Promise<RouterComparisonResult> => {
  const dimensions = classifyRouterDimensions(options.parameters, options.evidence)
  const activeNames = new Set(
    dimensions
      .filter((dimension) => dimension.status !== "inactive")
      .map((dimension) => dimension.name),
  )
  const parameters = options.pruneInactive
    ? options.parameters.filter((parameter) => activeNames.has(parameter.name))
    : options.parameters
  const archive = new Map<string, RouterComparisonCandidate>()
  const evaluateAndRecord: RouterComparisonSearchOptions["evaluateDevelopment"] = async (
    configs,
  ) => {
    const scores = await options.evaluateDevelopment(configs)
    for (let index = 0; index < configs.length; index++) {
      const config = configs[index]
      const score = scores[index]
      if (config !== undefined && score !== undefined)
        archive.set(routerKey(config), { config, score })
    }
    return scores
  }
  const initial = (await evaluate([options.seed], evaluateAndRecord))[0]!
  let selected = initial
  let evaluatedCandidates = 1
  const blocks = parameterBlocks(parameters)
  const passes = options.passes ?? 2

  if (options.method === "local-search") {
    const result = await improve(selected, parameters, evaluateAndRecord)
    selected = result.selected
    evaluatedCandidates += result.evaluations
  } else if (options.method === "staged") {
    for (const block of blocks) {
      const result = await improve(selected, block, evaluateAndRecord)
      selected = result.selected
      evaluatedCandidates += result.evaluations
    }
  } else if (options.method === "alternating-block-coordinate") {
    for (let pass = 0; pass < passes; pass++) {
      const ordered = pass % 2 === 0 ? blocks : [...blocks].reverse()
      for (const block of ordered) {
        const result = await improve(selected, block, evaluateAndRecord)
        selected = result.selected
        evaluatedCandidates += result.evaluations
      }
    }
  } else {
    const sequence = SCOUT_SEQUENCES.halton
    const restartCount = options.restarts ?? 4
    const points = sequence.points(Math.max(0, restartCount - 1), parameters.length)
    const starts = [
      options.seed,
      ...points.map((point) => {
        let config = options.seed
        for (let index = 0; index < parameters.length; index++) {
          const parameter = parameters[index]!
          config = parameter.update(
            config,
            parameter.values[scoutLevelIndex(point[index]!, parameter.values.length)]!,
          )
        }
        return config
      }),
    ]
    for (const start of await evaluate(starts, evaluateAndRecord)) {
      const result = await improve(start, parameters, evaluateAndRecord)
      if (compareCandidates(result.selected, selected) < 0) selected = result.selected
      evaluatedCandidates += result.evaluations + 1
    }
  }

  const candidates = [...archive.values()]
  return {
    model: options.model,
    method: options.method,
    optimalityClaim: "derivative-free-heuristic-no-global-optimality-claim",
    dimensions,
    evaluatedCandidates,
    selected,
    complexityAware: selectComplexityAwareCandidate(candidates, options.complexityPenalty ?? 0.001),
    oneStandardError: selectOneStandardErrorCandidate(candidates),
  }
}

/** Score fixed development-selected candidates on an excluded holdout without reselection. */
export const evaluateRouterComparisonHoldout = async (
  comparison: RouterComparisonResult,
  evaluateExcludedHoldout: (
    configs: readonly EvidenceRouterParameters[],
  ) => Promise<readonly RouterComparisonScore[]>,
): Promise<RouterComparisonHoldoutResult> => {
  const scores = await evaluateExcludedHoldout([
    comparison.selected.config,
    comparison.complexityAware.config,
    comparison.oneStandardError.config,
  ])
  const [selected, complexityAware, oneStandardError] = scores
  if (selected === undefined || complexityAware === undefined || oneStandardError === undefined)
    throw new Error("Router comparison holdout evaluator returned the wrong score count")
  return {
    model: comparison.model,
    method: comparison.method,
    selected,
    complexityAware,
    oneStandardError,
  }
}

/** Run the complete two-model, four-method comparison with a model-specific development evaluator. */
export const compareRouterModelsAndMethods = async (
  options: Omit<RouterComparisonSearchOptions, "model" | "method" | "evaluateDevelopment"> & {
    readonly evaluateDevelopment: (
      model: RouterModel,
      configs: readonly EvidenceRouterParameters[],
    ) => Promise<readonly RouterComparisonScore[]>
  },
): Promise<readonly RouterComparisonResult[]> => {
  const results: RouterComparisonResult[] = []
  for (const model of ROUTER_MODELS) {
    for (const method of ROUTER_FITTING_METHODS) {
      results.push(
        await searchRouterComparison({
          ...options,
          model,
          method,
          evaluateDevelopment: (configs) => options.evaluateDevelopment(model, configs),
        }),
      )
    }
  }
  return results
}
