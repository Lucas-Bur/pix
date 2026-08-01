import type { ChannelCoefficients, EvidenceRouterConfig } from "./evidence-router.js"
import { CHANNEL_NAMES } from "./ranking.js"
import type {
  BenchmarkArtifact,
  ChannelWeights,
  EvidenceRouterSearchResult,
  FusionSearchResult,
  ProductionRrfSearchResult,
  QueryMeasurement,
} from "./types.js"

const CHANNELS = CHANNEL_NAMES

const average = (rows: readonly QueryMeasurement[], select: (row: QueryMeasurement) => number) =>
  rows.reduce((sum, row) => sum + select(row), 0) / rows.length

const percent = (value: number): string => `${(value * 100).toFixed(1)}%`

const duration = (milliseconds: number): string => `${(milliseconds / 1_000).toFixed(2)} s`

const weightedAverage = <T extends { readonly validationQueries: number }>(
  rows: readonly T[],
  select: (row: T) => number,
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
    `G:${formatCoefficients(config.geometryInfluence)}`,
    `T:${formatCoefficients(config.termCoverageInfluence)}`,
    `P:${formatCoefficients(config.pairwiseAgreementInfluence)}`,
    `D:${formatCoefficients(config.denseConfidenceInfluence)}`,
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
    `Profile: ${artifact.benchmarkProfile}`,
    "",
    `Search strategy: \`${artifact.searchStrategy.algorithm}\` (${artifact.searchStrategy.globalScouts} global scouts, beam ${artifact.searchStrategy.beamWidth}, ${artifact.searchStrategy.coordinatePasses} coordinate passes, ${artifact.searchStrategy.proxySampleFraction * 100}% proxy with minimum ${artifact.searchStrategy.proxyMinimumSamples}, keep ${artifact.searchStrategy.halvingKeepFactor}x).`,
    "",
    `Context budgets use the documented \`${artifact.contextTokenEstimator}\` estimator.`,
    "",
    "## Run Timings",
    "",
    "Compute timings exclude JSON and Markdown artifact serialization.",
    "",
    "| Total | Corpus preparation | Embedding | Retrieval | Weight search | Fusion search | Router search |",
    "| ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    `| ${duration(artifact.timings.totalDurationMs)} | ${duration(artifact.timings.corpusPreparationDurationMs)} | ${duration(artifact.timings.embeddingDurationMs)} | ${duration(artifact.timings.retrievalDurationMs)} | ${duration(artifact.timings.weightSearchDurationMs)} | ${duration(artifact.timings.fusionSearchDurationMs)} | ${duration(artifact.timings.evidenceRouterSearchDurationMs)} |`,
    "",
    "## Sparse Encoder",
    "",
    "Sparse document vectors are cached separately from dense Float32 embeddings; query vectors use the static IDF lookup and do not run the document transformer.",
    "",
    "| Repository | Model | Tokenizer | Device | Model load | Chunk/cache | Query lookup | Cache hit |",
    "| --- | --- | --- | --- | ---: | ---: | ---: | --- |",
    ...artifact.sparseEmbeddingRuns.map(
      (run) =>
        `| ${run.repository} | ${run.model} | ${run.tokenizerModel} | ${run.device} | ${duration(run.modelLoadDurationMs)} | ${duration(run.chunkEmbeddingDurationMs)} | ${duration(run.queryEmbeddingDurationMs)} | ${run.cacheHit ? "yes" : "no"} |`,
    ),
    "",
    "| Repository | Model | Query form | Variant | R@5 | R@10 | R@20 | R@50 | S@10 | S@20 | MRR | Ctx@2k | Ctx@4k |",
    "| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
  ]

  for (const [key, rows] of [...groups].sort(([left], [right]) => left.localeCompare(right))) {
    const [repository, model, queryKind, variant] = key.split("\0")
    lines.push(
      `| ${repository} | ${model} | ${queryKind} | ${variant} | ${percent(average(rows, (row) => row.recallAt5))} | ${percent(average(rows, (row) => row.recallAt10))} | ${percent(average(rows, (row) => row.recallAt20))} | ${percent(average(rows, (row) => row.recallAt50))} | ${percent(average(rows, (row) => Number(row.successAt10)))} | ${percent(average(rows, (row) => Number(row.successAt20)))} | ${average(rows, (row) => row.reciprocalRank).toFixed(3)} | ${percent(average(rows, (row) => row.contextRecall["2048"] ?? 0))} | ${percent(average(rows, (row) => row.contextRecall["4096"] ?? 0))} |`,
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
    "Positive means the channel improves full RRF recall compared with removing it; Sparse compares the sparse-inclusive RRF variant with the existing four-channel RRF.",
    "",
    "| Repository | Model | Query form | Identity | CamelCase | BM25 | Dense | Sparse |",
    "| --- | --- | --- | ---: | ---: | ---: | ---: | ---: |",
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
      `| ${repository} | ${model} | ${queryKind} | ${percent(full - recall("rrf-no-identity"))} | ${percent(full - recall("rrf-no-camelcase"))} | ${percent(full - recall("rrf-no-bm25"))} | ${percent(full - recall("rrf-no-dense"))} | ${percent(recall("rrf+sparse") - full)} |`,
    )
  }

  const productionGroups = new Map<string, ProductionRrfSearchResult[]>()
  for (const result of artifact.productionRrfSearch) {
    const key = `${result.model}\0${result.strategy}`
    productionGroups.set(key, [...(productionGroups.get(key) ?? []), result])
  }
  lines.push(
    "",
    "## Production RRF Holdouts",
    "",
    "These rows evaluate the current production query-length router unchanged; they are the baseline for objective guardrails.",
    "",
    "| Model | Strategy | Validation R@5 | Validation R@10 | Validation R@20 | Validation R@50 | Validation Ctx@4k |",
    "| --- | --- | ---: | ---: | ---: | ---: | ---: |",
  )
  for (const [key, rows] of [...productionGroups].sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    const [model, strategy] = key.split("\0")
    lines.push(
      `| ${model} | ${strategy} | ${percent(weightedAverage(rows, (row) => row.validation.recallAt5))} | ${percent(weightedAverage(rows, (row) => row.validation.recallAt10))} | ${percent(weightedAverage(rows, (row) => row.validation.recallAt20))} | ${percent(weightedAverage(rows, (row) => row.validation.recallAt50))} | ${percent(weightedAverage(rows, (row) => row.validation.contextRecallAt4096))} |`,
    )
  }

  lines.push(
    "",
    "## Cross-Validated Weights",
    "",
    "Each row selects weights without its validation fold. Validation quality and Shapley contributions use only the excluded fold.",
    "",
    "| Model | Query form | Strategy | Fold | Weights I/C/B/D/S | Dev R@20 | Validation R@5 | Validation R@10 | Validation R@20 | Validation Ctx@4k | Shapley I/C/B/D/S |",
    "| --- | --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- |",
  )
  for (const result of artifact.weightSearch) {
    const weights = formatWeights(result.weights)
    const shapley = CHANNELS.map((channel) => percent(result.shapleyRecallAt20[channel])).join("/")
    lines.push(
      `| ${result.model} | ${result.queryKind} | ${result.strategy} | ${result.fold} | ${weights} | ${percent(result.development.recallAt20)} | ${percent(result.validation.recallAt5)} | ${percent(result.validation.recallAt10)} | ${percent(result.validation.recallAt20)} | ${percent(result.validation.contextRecallAt4096)} | ${shapley} |`,
    )
  }

  lines.push(
    "",
    "## Recommended Weights",
    "",
    "These deployment candidates are fitted on all available samples only after cross-validation.",
    "",
    "| Model | Query form | Samples | Weights I/C/B/D/S | Fit R@5 | Fit R@20 |",
    "| --- | --- | ---: | --- | ---: | ---: |",
  )
  for (const result of artifact.recommendedWeights) {
    const weights = formatWeights(result.weights)
    lines.push(
      `| ${result.model} | ${result.queryKind} | ${result.samples} | ${weights} | ${percent(result.fitQuality.recallAt5)} | ${percent(result.fitQuality.recallAt20)} |`,
    )
  }

  const fusionGroups = new Map<string, FusionSearchResult[]>()
  for (const result of artifact.fusionSearch) {
    const key = `${result.model}\0${result.fusion}\0${result.strategy}`
    fusionGroups.set(key, [...(fusionGroups.get(key) ?? []), result])
  }
  lines.push(
    "",
    "## Static Fusion Holdouts",
    "",
    "Each fusion method selects its own positive weights on development samples. Validation metrics are weighted by excluded query count.",
    "",
    "| Model | Fusion | Strategy | Weights I/C/B/D/S by fold | Validation R@5 | Validation R@10 | Validation R@20 | Validation Ctx@4k |",
    "| --- | --- | --- | --- | ---: | ---: | ---: | ---: |",
  )
  for (const [key, rows] of fusionGroups) {
    const [model, fusion, strategy] = key.split("\0")
    lines.push(
      `| ${model} | ${fusion} | ${strategy} | ${rows.map((row) => formatWeights(row.weights)).join("; ")} | ${percent(weightedAverage(rows, (row) => row.validation.recallAt5))} | ${percent(weightedAverage(rows, (row) => row.validation.recallAt10))} | ${percent(weightedAverage(rows, (row) => row.validation.recallAt20))} | ${percent(weightedAverage(rows, (row) => row.validation.contextRecallAt4096))} |`,
    )
  }

  lines.push(
    "",
    "## Recommended Static Fusion",
    "",
    "Fit-all candidates are descriptive; excluded-fold rows above measure generalization.",
    "",
    "| Model | Fusion | Samples | Weights I/C/B/D/S | Fit R@5 | Fit R@10 | Fit R@20 | Fit Ctx@4k |",
    "| --- | --- | ---: | --- | ---: | ---: | ---: | ---: |",
  )
  for (const result of artifact.recommendedFusionWeights) {
    lines.push(
      `| ${result.model} | ${result.fusion} | ${result.samples} | ${formatWeights(result.weights)} | ${percent(result.fitQuality.recallAt5)} | ${percent(result.fitQuality.recallAt10)} | ${percent(result.fitQuality.recallAt20)} | ${percent(result.fitQuality.contextRecallAt4096)} |`,
    )
  }

  lines.push(
    "",
    "## Evidence Router Holdouts",
    "",
    "One shared search produces direct, reranker-top20, and reranker-top50 candidates. Production RRF is the guardrail baseline; static and dynamic validation columns use the same fusion method and excluded fold.",
    "",
    "| Model | Fusion | Objective | Strategy | Fold | Guardrails | Proxy evals | Full evals | Static I/C/B/D/S | Dynamic base I/C/B/D/S | Influence Score/Geometry/TermCoverage/PairwiseAgreement/DenseConfidence/Identifier/Length | Static R@5 | Dynamic R@5 | Static R@10 | Dynamic R@10 | Static R@20 | Dynamic R@20 | Dynamic R@50 | Static Ctx@4k | Dynamic Ctx@4k |",
    "| --- | --- | --- | --- | --- | --- | ---: | ---: | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
  )
  for (const result of artifact.evidenceRouterSearch) {
    const baseWeights = formatWeights(result.config.baseWeights)
    const staticWeights = formatWeights(result.staticWeights)
    const influences = formatInfluences(result.config)
    lines.push(
      `| ${result.model} | ${result.fusion} | ${result.objective} | ${result.strategy} | ${result.fold} | ${result.guardrailsMet ? "yes" : "no"} | ${result.proxyEvaluations} | ${result.fullEvaluations} | ${staticWeights} | ${baseWeights} | ${influences} | ${percent(result.staticValidation.recallAt5)} | ${percent(result.validation.recallAt5)} | ${percent(result.staticValidation.recallAt10)} | ${percent(result.validation.recallAt10)} | ${percent(result.staticValidation.recallAt20)} | ${percent(result.validation.recallAt20)} | ${percent(result.validation.recallAt50)} | ${percent(result.staticValidation.contextRecallAt4096)} | ${percent(result.validation.contextRecallAt4096)} |`,
    )
  }

  const routerGroups = new Map<string, EvidenceRouterSearchResult[]>()
  for (const result of artifact.evidenceRouterSearch) {
    const key = `${result.model}\0${result.fusion}\0${result.objective}\0${result.strategy}`
    routerGroups.set(key, [...(routerGroups.get(key) ?? []), result])
  }
  lines.push(
    "",
    "## Evidence Router Summary",
    "",
    "Validation metrics are weighted by each excluded fold's query count. Production RRF is shown beside the selected dynamic router.",
    "",
    "| Model | Fusion | Objective | Strategy | Guardrails | Production R@5 | Dynamic R@5 | Production R@10 | Dynamic R@10 | Production R@20 | Dynamic R@20 | Production R@50 | Dynamic R@50 | Production Ctx@4k | Dynamic Ctx@4k |",
    "| --- | --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
  )
  for (const [key, rows] of routerGroups) {
    const [model, fusion, objective, strategy] = key.split("\0")
    lines.push(
      `| ${model} | ${fusion} | ${objective} | ${strategy} | ${rows.every((row) => row.guardrailsMet) ? "yes" : "no"} | ${percent(weightedAverage(rows, (row) => row.productionValidation.recallAt5))} | ${percent(weightedAverage(rows, (row) => row.validation.recallAt5))} | ${percent(weightedAverage(rows, (row) => row.productionValidation.recallAt10))} | ${percent(weightedAverage(rows, (row) => row.validation.recallAt10))} | ${percent(weightedAverage(rows, (row) => row.productionValidation.recallAt20))} | ${percent(weightedAverage(rows, (row) => row.validation.recallAt20))} | ${percent(weightedAverage(rows, (row) => row.productionValidation.recallAt50))} | ${percent(weightedAverage(rows, (row) => row.validation.recallAt50))} | ${percent(weightedAverage(rows, (row) => row.productionValidation.contextRecallAt4096))} | ${percent(weightedAverage(rows, (row) => row.validation.contextRecallAt4096))} |`,
    )
  }

  lines.push(
    "",
    "## Recommended Evidence Router",
    "",
    "These scenario-specific candidates are fitted across all query forms only after grouped and repository holdouts have measured generalization.",
    "",
    "| Model | Fusion | Objective | Guardrails | Samples | Proxy evals | Full evals | Static I/C/B/D/S | Dynamic base I/C/B/D/S | Influence Score/Geometry/TermCoverage/PairwiseAgreement/DenseConfidence/Identifier/Length | Static R@5 | Dynamic R@5 | Static R@10 | Dynamic R@10 | Static R@20 | Dynamic R@20 | Dynamic R@50 | Static Ctx@4k | Dynamic Ctx@4k |",
    "| --- | --- | --- | --- | ---: | ---: | ---: | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
  )
  for (const result of artifact.recommendedEvidenceRouters) {
    const baseWeights = formatWeights(result.config.baseWeights)
    const staticWeights = formatWeights(result.staticWeights)
    const influences = formatInfluences(result.config)
    lines.push(
      `| ${result.model} | ${result.fusion} | ${result.objective} | ${result.guardrailsMet ? "yes" : "no"} | ${result.samples} | ${result.proxyEvaluations} | ${result.fullEvaluations} | ${staticWeights} | ${baseWeights} | ${influences} | ${percent(result.staticQuality.recallAt5)} | ${percent(result.fitQuality.recallAt5)} | ${percent(result.staticQuality.recallAt10)} | ${percent(result.fitQuality.recallAt10)} | ${percent(result.staticQuality.recallAt20)} | ${percent(result.fitQuality.recallAt20)} | ${percent(result.fitQuality.recallAt50)} | ${percent(result.staticQuality.contextRecallAt4096)} | ${percent(result.fitQuality.contextRecallAt4096)} |`,
    )
  }

  return `${lines.join("\n")}\n`
}
