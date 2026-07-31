import type { ChannelCoefficients, EvidenceRouterConfig } from "./evidence-router.js"
import type {
  BenchmarkArtifact,
  ChannelWeights,
  EvidenceRouterSearchResult,
  QueryMeasurement,
} from "./types.js"

const CHANNELS = ["identity", "camelcase", "bm25", "dense"] as const

const average = (rows: readonly QueryMeasurement[], select: (row: QueryMeasurement) => number) =>
  rows.reduce((sum, row) => sum + select(row), 0) / rows.length

const percent = (value: number): string => `${(value * 100).toFixed(1)}%`

const weightedRouterAverage = (
  rows: readonly EvidenceRouterSearchResult[],
  select: (row: EvidenceRouterSearchResult) => number,
): number => {
  const samples = rows.reduce((sum, row) => sum + row.validationQueries, 0)
  return samples === 0
    ? 0
    : rows.reduce((sum, row) => sum + select(row) * row.validationQueries, 0) / samples
}

const formatWeights = (weights: ChannelWeights): string =>
  CHANNELS.map((channel) => weights[channel].toFixed(2)).join("/")

const formatCoefficients = (coefficients: ChannelCoefficients): string =>
  CHANNELS.map((channel) => coefficients[channel].toFixed(2)).join("/")

const formatInfluences = (config: EvidenceRouterConfig): string =>
  [
    `S:${formatCoefficients(config.scoreInfluence)}`,
    `A:${formatCoefficients(config.agreementInfluence)}`,
    `I:${formatCoefficients(config.identifierInfluence)}`,
    `L:${formatCoefficients(config.queryLengthInfluence)}`,
  ].join("; ")

/** Render quality and marginal channel contribution grouped by query representation. */
export const renderMarkdownReport = (artifact: BenchmarkArtifact): string => {
  const groups = new Map<string, QueryMeasurement[]>()
  for (const row of artifact.measurements) {
    const key = [row.repository, row.model, row.queryKind, row.variant].join("\0")
    const group = groups.get(key) ?? []
    group.push(row)
    groups.set(key, group)
  }

  const lines = [
    "# Retrieval Quality Benchmark",
    "",
    `Generated: ${artifact.generatedAt}`,
    "",
    `Context budgets use the documented \`${artifact.contextTokenEstimator}\` estimator.`,
    "",
    "| Repository | Model | Query form | Variant | R@5 | R@10 | R@20 | S@10 | S@20 | MRR | Ctx@2k | Ctx@4k |",
    "| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
  ]

  for (const [key, rows] of [...groups].sort(([left], [right]) => left.localeCompare(right))) {
    const [repository, model, queryKind, variant] = key.split("\0")
    lines.push(
      `| ${repository} | ${model} | ${queryKind} | ${variant} | ${percent(average(rows, (row) => row.recallAt5))} | ${percent(average(rows, (row) => row.recallAt10))} | ${percent(average(rows, (row) => row.recallAt20))} | ${percent(average(rows, (row) => Number(row.successAt10)))} | ${percent(average(rows, (row) => Number(row.successAt20)))} | ${average(rows, (row) => row.reciprocalRank).toFixed(3)} | ${percent(average(rows, (row) => row.contextRecall["2048"] ?? 0))} | ${percent(average(rows, (row) => row.contextRecall["4096"] ?? 0))} |`,
    )
  }

  const contributionGroups = new Map<string, QueryMeasurement[]>()
  for (const row of artifact.measurements) {
    const key = [row.repository, row.model, row.queryKind].join("\0")
    contributionGroups.set(key, [...(contributionGroups.get(key) ?? []), row])
  }
  lines.push(
    "",
    "## Marginal RRF Contribution at 20",
    "",
    "Positive means the channel improves full RRF recall compared with removing it; negative means it hurts recall.",
    "",
    "| Repository | Model | Query form | Identity | CamelCase | BM25 | Dense |",
    "| --- | --- | --- | ---: | ---: | ---: | ---: |",
  )
  for (const [key, rows] of [...contributionGroups].sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    const [repository, model, queryKind] = key.split("\0")
    const recall = (variant: QueryMeasurement["variant"]): number => {
      const selected = rows.filter((row) => row.variant === variant)
      return selected.length === 0 ? 0 : average(selected, (row) => row.recallAt20)
    }
    const full = recall("rrf")
    lines.push(
      `| ${repository} | ${model} | ${queryKind} | ${percent(full - recall("rrf-no-identity"))} | ${percent(full - recall("rrf-no-camelcase"))} | ${percent(full - recall("rrf-no-bm25"))} | ${percent(full - recall("rrf-no-dense"))} |`,
    )
  }

  lines.push(
    "",
    "## Cross-Validated Weights",
    "",
    "Each row selects weights without its validation fold. Validation quality and Shapley contributions use only the excluded fold.",
    "",
    "| Model | Query form | Strategy | Fold | Weights I/C/B/D | Dev R@20 | Validation R@10 | Validation R@20 | Validation Ctx@4k | Shapley I/C/B/D |",
    "| --- | --- | --- | --- | --- | ---: | ---: | ---: | ---: | --- |",
  )
  for (const result of artifact.weightSearch) {
    const weights = formatWeights(result.weights)
    const shapley = CHANNELS.map((channel) => percent(result.shapleyRecallAt20[channel])).join("/")
    lines.push(
      `| ${result.model} | ${result.queryKind} | ${result.strategy} | ${result.fold} | ${weights} | ${percent(result.development.recallAt20)} | ${percent(result.validation.recallAt10)} | ${percent(result.validation.recallAt20)} | ${percent(result.validation.contextRecallAt4096)} | ${shapley} |`,
    )
  }

  lines.push(
    "",
    "## Recommended Weights",
    "",
    "These deployment candidates are fitted on all available samples only after cross-validation.",
    "",
    "| Model | Query form | Samples | Weights I/C/B/D | Fit R@20 |",
    "| --- | --- | ---: | --- | ---: |",
  )
  for (const result of artifact.recommendedWeights) {
    const weights = formatWeights(result.weights)
    lines.push(
      `| ${result.model} | ${result.queryKind} | ${result.samples} | ${weights} | ${percent(result.fitQuality.recallAt20)} |`,
    )
  }

  lines.push(
    "",
    "## Evidence Router Holdouts",
    "",
    "One router is selected across all query forms using only observable query features, scale-independent score separation, and cross-channel agreement. Static and dynamic validation columns use the same excluded fold.",
    "",
    "| Model | Strategy | Fold | Static I/C/B/D | Dynamic base I/C/B/D | Influence Score/Agreement/Identifier/Length | Static R@10 | Dynamic R@10 | Static R@20 | Dynamic R@20 | Static Ctx@4k | Dynamic Ctx@4k |",
    "| --- | --- | --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |",
  )
  for (const result of artifact.evidenceRouterSearch) {
    const baseWeights = formatWeights(result.config.baseWeights)
    const staticWeights = formatWeights(result.staticWeights)
    const influences = formatInfluences(result.config)
    lines.push(
      `| ${result.model} | ${result.strategy} | ${result.fold} | ${staticWeights} | ${baseWeights} | ${influences} | ${percent(result.staticValidation.recallAt10)} | ${percent(result.validation.recallAt10)} | ${percent(result.staticValidation.recallAt20)} | ${percent(result.validation.recallAt20)} | ${percent(result.staticValidation.contextRecallAt4096)} | ${percent(result.validation.contextRecallAt4096)} |`,
    )
  }

  const routerGroups = new Map<string, EvidenceRouterSearchResult[]>()
  for (const result of artifact.evidenceRouterSearch) {
    const key = `${result.model}\0${result.strategy}`
    routerGroups.set(key, [...(routerGroups.get(key) ?? []), result])
  }
  lines.push(
    "",
    "## Evidence Router Summary",
    "",
    "Validation metrics are weighted by each excluded fold's query count.",
    "",
    "| Model | Strategy | Static R@10 | Dynamic R@10 | Static R@20 | Dynamic R@20 | Static Ctx@4k | Dynamic Ctx@4k |",
    "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |",
  )
  for (const [key, rows] of routerGroups) {
    const [model, strategy] = key.split("\0")
    lines.push(
      `| ${model} | ${strategy} | ${percent(weightedRouterAverage(rows, (row) => row.staticValidation.recallAt10))} | ${percent(weightedRouterAverage(rows, (row) => row.validation.recallAt10))} | ${percent(weightedRouterAverage(rows, (row) => row.staticValidation.recallAt20))} | ${percent(weightedRouterAverage(rows, (row) => row.validation.recallAt20))} | ${percent(weightedRouterAverage(rows, (row) => row.staticValidation.contextRecallAt4096))} | ${percent(weightedRouterAverage(rows, (row) => row.validation.contextRecallAt4096))} |`,
    )
  }

  lines.push(
    "",
    "## Recommended Evidence Router",
    "",
    "These candidates are fitted across all query forms only after grouped and repository holdouts have measured generalization.",
    "",
    "| Model | Samples | Static I/C/B/D | Dynamic base I/C/B/D | Influence Score/Agreement/Identifier/Length | Static R@10 | Dynamic R@10 | Static R@20 | Dynamic R@20 |",
    "| --- | ---: | --- | --- | --- | ---: | ---: | ---: | ---: |",
  )
  for (const result of artifact.recommendedEvidenceRouters) {
    const baseWeights = formatWeights(result.config.baseWeights)
    const staticWeights = formatWeights(result.staticWeights)
    const influences = formatInfluences(result.config)
    lines.push(
      `| ${result.model} | ${result.samples} | ${staticWeights} | ${baseWeights} | ${influences} | ${percent(result.staticQuality.recallAt10)} | ${percent(result.fitQuality.recallAt10)} | ${percent(result.staticQuality.recallAt20)} | ${percent(result.fitQuality.recallAt20)} |`,
    )
  }

  return `${lines.join("\n")}\n`
}
