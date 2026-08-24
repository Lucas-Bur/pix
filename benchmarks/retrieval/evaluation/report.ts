import {
  CHANNEL_NAMES,
  type ChannelCoefficients,
  type ChannelWeights,
  type EvidenceRouterConfig,
} from "../../../src/domain/retrieval.js"
import { describeScoutSequence } from "./scout-sequence.js"
import type {
  BenchmarkArtifact,
  EvidenceRouterSearchResult,
  FusionSearchResult,
  HoldoutQuality,
  ProductionRouterSearchResult,
  PromotionStatus,
  QueryMeasurement,
} from "./types.js"

const CHANNELS = CHANNEL_NAMES

const average = (rows: readonly QueryMeasurement[], select: (row: QueryMeasurement) => number) =>
  rows.reduce((sum, row) => sum + select(row), 0) / rows.length

const percent = (value: number): string => `${(value * 100).toFixed(1)}%`

const promotionLabel = (status: PromotionStatus): string =>
  status === "eligible" ? "eligible" : "no eligible candidate"

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

const formatRouterWeightColumns = (result: {
  readonly config: EvidenceRouterConfig
  readonly staticWeights: ChannelWeights
}) => ({
  baseWeights: formatWeights(result.config.baseWeights),
  staticWeights: formatWeights(result.staticWeights),
  influences: formatInfluences(result.config),
})

const renderPromotionEvidence = (artifact: BenchmarkArtifact): readonly string[] => {
  const summaries = artifact.promotionEvidence.map(
    (evidence) =>
      `| ${evidence.model} | ${evidence.fusion} | ${evidence.objective} | ${promotionLabel(evidence.promotionStatus)} | ${evidence.missingStrategies.join(", ") || "none"} | ${evidence.finalTest.strategy}:${evidence.finalTest.fold} (${evidence.finalTest.guardrailsMet ? "pass" : "fail"}) | ${evidence.stability.folds} | ${evidence.stability.distinctSelections} | ${percent(evidence.stability.selectionFrequency)} | ${evidence.stability.localPerturbations} | ${evidence.stability.plateauWidth.toFixed(3)} | ${percent(evidence.stability.epsilonNeighborFraction)} | ${percent(evidence.stability.medianHoldoutDrop)} | ${percent(evidence.stability.worstCaseHoldoutDrop)} |`,
  )
  const blockers = artifact.promotionEvidence.flatMap((evidence) =>
    evidence.blockers.map(
      (blocker) =>
        `| ${evidence.model} | ${evidence.fusion} | ${evidence.objective} | ${blocker.strategy} | ${blocker.fold} | ${blocker.partition}:${blocker.name} | ${blocker.metric} | ${percent(blocker.candidateValue)} | ${percent(blocker.baselineValue)} | ${percent(blocker.tolerance)} | ${percent(blocker.delta)} |`,
    ),
  )
  const uncertainty = artifact.promotionEvidence.flatMap((evidence) =>
    evidence.uncertainty.map(
      (interval) =>
        `| ${evidence.model} | ${evidence.fusion} | ${evidence.objective} | ${interval.strategy} | ${interval.partition}:${interval.name} | ${interval.metric} | ${percent(interval.meanDelta)} | ${percent(interval.lowerBound)} | ${percent(interval.upperBound)} | ${interval.bootstrapSamples} |`,
    ),
  )
  return [
    "",
    "## Promotion Evidence",
    "",
    "Fit-all quality is diagnostic. Promotion status below is derived only from excluded grouped and repository holdouts; missing required strategies block promotion.",
    "",
    "| Model | Fusion | Objective | Promotion | Missing strategies | Final test | Folds | Distinct selections | Selection frequency | Local perturbations | Plateau width | Epsilon neighbors | Median drop | Worst drop |",
    "| --- | --- | --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...summaries,
    "",
    "### Guardrail Blockers",
    "",
    "| Model | Fusion | Objective | Strategy | Fold | Partition | Metric | Candidate | Baseline | Tolerance | Delta |",
    "| --- | --- | --- | --- | --- | --- | --- | ---: | ---: | ---: | ---: |",
    ...(blockers.length === 0
      ? ["| - | - | - | - | - | - | - | - | - | - | no blockers |"]
      : blockers),
    "",
    "### Holdout Uncertainty",
    "",
    "Deterministic grouped bootstrap intervals resample excluded folds and report paired candidate-minus-baseline deltas.",
    "",
    "| Model | Fusion | Objective | Strategy | Partition | Metric | Mean delta | 95% lower | 95% upper | Bootstrap samples |",
    "| --- | --- | --- | --- | --- | --- | ---: | ---: | ---: | ---: |",
    ...uncertainty,
  ]
}

/** Render quality and marginal channel contribution grouped by query representation. */
export const renderMarkdownReport = (artifact: BenchmarkArtifact): string => {
  const groups = new Map<string, QueryMeasurement[]>()
  for (const row of artifact.measurements) {
    const key = [row.repository, row.model, row.queryKind, row.variant].join("\0")
    const group = groups.get(key) ?? []
    group.push(row)
    groups.set(key, group)
  }
  const strategyFactorLabel = artifact.searchStrategy.algorithm.includes("successive-halving")
    ? "keep"
    : "promotion"
  const strategyFactor =
    "halvingKeepFactor" in artifact.searchStrategy
      ? artifact.searchStrategy.halvingKeepFactor
      : artifact.searchStrategy.proxyPromotionFactor

  const lines = [
    "# Retrieval Quality Benchmark",
    "",
    `Generated: ${artifact.generatedAt}`,
    "",
    `Profile: ${artifact.benchmarkProfile}`,
    "",
    `Optimization profile: \`${artifact.optimizationProfile.name}\` (${artifact.optimizationProfile.provenance}) with query-form weights ${Object.entries(
      artifact.optimizationProfile.queryFormWeights,
    )
      .map(([kind, weight]) => `${kind}=${weight}`)
      .join(", ")}.`,
    "",
    "The `direct` objective selects NDCG@5 first; `direct-recall-first` is the matched historical-objective ablation. Reranker objectives remain recall-first.",
    "",
    `Validation protocol: candidates use ${artifact.validationProtocol.selection}; holdouts are ${artifact.validationProtocol.holdouts.join(" and ")}; final promotion requires untouched ${artifact.validationProtocol.finalTest.strategy} fold ${artifact.validationProtocol.finalTest.fold}.`,
    "",
    `Search algorithm: \`${artifact.searchStrategy.algorithm}\`.`,
    "",
    `Beam starting points: ${artifact.searchStrategy.globalScouts} ${artifact.scoutSequence} scouts (${describeScoutSequence(artifact.scoutSequence)}).`,
    "",
    `Beam refinement: beam width ${artifact.searchStrategy.beamWidth}, ${artifact.searchStrategy.coordinatePasses} alternating coordinate passes.`,
    "",
    `Cheap pre-scoring: candidates first score on a deterministic ${artifact.searchStrategy.proxySampleFraction * 100}% proxy sample with a minimum of ${artifact.searchStrategy.proxyMinimumSamples}; the ${strategyFactorLabel} factor is ${strategyFactor}x.`,
    "",
    `Context budgets use the documented \`${artifact.contextTokenEstimator}\` estimator.`,
    "",
    "## Run Timings",
    "",
    "Compute timings exclude JSON and Markdown artifact serialization.",
    "",
    "| Total | Corpus preparation | Embedding | Retrieval | Weight search | Fusion search | Router search | Candidate queue startup | Candidate queue shutdown |",
    "| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    `| ${duration(artifact.timings.totalDurationMs)} | ${duration(artifact.timings.corpusPreparationDurationMs)} | ${duration(artifact.timings.embeddingDurationMs)} | ${duration(artifact.timings.retrievalDurationMs)} | ${duration(artifact.timings.weightSearchDurationMs)} | ${duration(artifact.timings.fusionSearchDurationMs)} | ${duration(artifact.timings.evidenceRouterSearchDurationMs)} | ${duration(artifact.timings.candidateQueueStartupDurationMs)} | ${duration(artifact.timings.candidateQueueShutdownDurationMs)} |`,
    "",
    "## Sparse Encoder",
    "",
    "The production SparseEmbedder creates document vectors and tokenizes queries. The production SQLite IndexStore persists postings and IDF in the in-memory benchmark database, then computes exact query scores.",
    "",
    "| Repository | Model | Tokenizer | Batch | Chunk embedding | Query tokenization |",
    "| --- | --- | --- | ---: | ---: | ---: |",
    ...artifact.sparseEmbeddingRuns.map(
      (run) =>
        `| ${run.repository} | ${run.model} | ${run.tokenizerModel} | ${run.batchSize} | ${duration(run.chunkEmbeddingDurationMs)} | ${duration(run.queryTokenizationDurationMs)} |`,
    ),
    "",
    "| Repository | Model | Query form | Variant | R@5 | R@10 | R@20 | R@50 | NDCG@5 | NDCG@10 | NDCG@20 | NDCG@50 | S@10 | S@20 | MRR | Ctx@2k | Ctx@4k |",
    "| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
  ]

  for (const [key, rows] of [...groups].sort(([left], [right]) => left.localeCompare(right))) {
    const [repository, model, queryKind, variant] = key.split("\0")
    lines.push(
      `| ${repository} | ${model} | ${queryKind} | ${variant} | ${percent(average(rows, (row) => row.recallAt5))} | ${percent(average(rows, (row) => row.recallAt10))} | ${percent(average(rows, (row) => row.recallAt20))} | ${percent(average(rows, (row) => row.recallAt50))} | ${percent(average(rows, (row) => row.ndcgAt5))} | ${percent(average(rows, (row) => row.ndcgAt10))} | ${percent(average(rows, (row) => row.ndcgAt20))} | ${percent(average(rows, (row) => row.ndcgAt50))} | ${percent(average(rows, (row) => Number(row.successAt10)))} | ${percent(average(rows, (row) => Number(row.successAt20)))} | ${average(rows, (row) => row.reciprocalRank).toFixed(3)} | ${percent(average(rows, (row) => row.contextRecall["2048"] ?? 0))} | ${percent(average(rows, (row) => row.contextRecall["4096"] ?? 0))} |`,
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
    "Positive means the channel improves the five-channel equal-weight RRF baseline compared with removing it.",
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
    const full = recall("rrf-equal")
    lines.push(
      `| ${repository} | ${model} | ${queryKind} | ${percent(full - recall("rrf-no-identity"))} | ${percent(full - recall("rrf-no-camelcase"))} | ${percent(full - recall("rrf-no-bm25"))} | ${percent(full - recall("rrf-no-dense"))} | ${percent(full - recall("rrf-no-sparse"))} |`,
    )
  }

  const productionGroups = new Map<string, ProductionRouterSearchResult[]>()
  for (const result of artifact.productionRouterSearch) {
    const key = `${result.model}\0${result.strategy}`
    productionGroups.set(key, [...(productionGroups.get(key) ?? []), result])
  }
  lines.push(
    "",
    "## Current Production Router Holdouts",
    "",
    "These rows evaluate the current Production compatibility router unchanged; it is the guardrail baseline for candidate comparisons. Historical RRF remains an explicit diagnostic variant.",
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
    "Each fusion method selects its own positive weights on development samples. Validation metrics are weighted by excluded query count. A guardrail failure is reported as no eligible candidate and is diagnostic only.",
    "",
    "| Model | Fusion | Strategy | Promotion | Weights I/C/B/D/S by fold | Validation R@5 | Validation R@10 | Validation R@20 | Validation Ctx@4k |",
    "| --- | --- | --- | --- | --- | ---: | ---: | ---: | ---: |",
  )
  for (const [key, rows] of fusionGroups) {
    const [model, fusion, strategy] = key.split("\0")
    lines.push(
      `| ${model} | ${fusion} | ${strategy} | ${promotionLabel(rows.every((row) => row.promotionStatus === "eligible") ? "eligible" : "no-eligible-candidate")} | ${rows.map((row) => formatWeights(row.weights)).join("; ")} | ${percent(weightedAverage(rows, (row) => row.validation.recallAt5))} | ${percent(weightedAverage(rows, (row) => row.validation.recallAt10))} | ${percent(weightedAverage(rows, (row) => row.validation.recallAt20))} | ${percent(weightedAverage(rows, (row) => row.validation.contextRecallAt4096))} |`,
    )
  }

  lines.push(
    "",
    "## Recommended Static Fusion",
    "",
    "Fit-all candidates are descriptive; excluded-fold rows above measure generalization.",
    "",
    "| Model | Fusion | Samples | Promotion | Weights I/C/B/D/S | Fit R@5 | Fit R@10 | Fit R@20 | Fit Ctx@4k |",
    "| --- | --- | ---: | --- | --- | ---: | ---: | ---: | ---: |",
  )
  for (const result of artifact.recommendedFusionWeights) {
    lines.push(
      `| ${result.model} | ${result.fusion} | ${result.samples} | ${promotionLabel(result.promotionStatus)} | ${formatWeights(result.weights)} | ${percent(result.fitQuality.recallAt5)} | ${percent(result.fitQuality.recallAt10)} | ${percent(result.fitQuality.recallAt20)} | ${percent(result.fitQuality.contextRecallAt4096)} |`,
    )
  }

  lines.push(
    "",
    "## Evidence Router Holdouts",
    "",
    "One shared search produces NDCG-first direct, Recall-first direct-ablation, reranker-top20, and reranker-top50 candidates. The current Production router is the guardrail baseline; static and dynamic validation columns use the same fusion method and excluded fold. A no eligible candidate result must not be promoted.",
    "",
    "| Model | Fusion | Objective | Strategy | Fold | Promotion | Params | Proxy evals | Full evals | Proxy agreement | Static I/C/B/D/S | Dynamic base I/C/B/D/S | Influence Score/Geometry/TermCoverage/PairwiseAgreement/DenseConfidence/Identifier/Length | Static R@5 | Dynamic R@5 | Static R@10 | Dynamic R@10 | Static R@20 | Dynamic R@20 | Dynamic R@50 | Static Ctx@4k | Dynamic Ctx@4k |",
    "| --- | --- | --- | --- | --- | --- | ---: | ---: | ---: | ---: | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
  )
  for (const result of artifact.evidenceRouterSearch) {
    const { baseWeights, staticWeights, influences } = formatRouterWeightColumns(result)
    lines.push(
      `| ${result.model} | ${result.fusion} | ${result.objective} | ${result.strategy} | ${result.fold} | ${promotionLabel(result.promotionStatus)} | ${result.searchDiagnostics.parameterCount} | ${result.proxyEvaluations} | ${result.fullEvaluations} | ${percent(result.searchDiagnostics.proxyFullAgreement)} | ${staticWeights} | ${baseWeights} | ${influences} | ${percent(result.staticValidation.recallAt5)} | ${percent(result.validation.recallAt5)} | ${percent(result.staticValidation.recallAt10)} | ${percent(result.validation.recallAt10)} | ${percent(result.staticValidation.recallAt20)} | ${percent(result.validation.recallAt20)} | ${percent(result.validation.recallAt50)} | ${percent(result.staticValidation.contextRecallAt4096)} | ${percent(result.validation.contextRecallAt4096)} |`,
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
    "Validation metrics are weighted by each excluded fold's query count. The current Production router is shown beside the selected dynamic router.",
    "",
    "| Model | Fusion | Objective | Strategy | Promotion | Search baseline | Production R@5 | Dynamic R@5 | Production R@10 | Dynamic R@10 | Production R@20 | Dynamic R@20 | Production R@50 | Dynamic R@50 | Production Ctx@4k | Dynamic Ctx@4k | Random R@20 | Random Ctx@4k |",
    "| --- | --- | --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
  )
  for (const [key, rows] of routerGroups) {
    const [model, fusion, objective, strategy] = key.split("\0")
    lines.push(
      `| ${model} | ${fusion} | ${objective} | ${strategy} | ${promotionLabel(rows.every((row) => row.promotionStatus === "eligible") ? "eligible" : "no-eligible-candidate")} | ${rows[0]?.searchBaseline.algorithm ?? "unknown"} | ${percent(weightedAverage(rows, (row) => row.productionValidation.recallAt5))} | ${percent(weightedAverage(rows, (row) => row.validation.recallAt5))} | ${percent(weightedAverage(rows, (row) => row.productionValidation.recallAt10))} | ${percent(weightedAverage(rows, (row) => row.validation.recallAt10))} | ${percent(weightedAverage(rows, (row) => row.productionValidation.recallAt20))} | ${percent(weightedAverage(rows, (row) => row.validation.recallAt20))} | ${percent(weightedAverage(rows, (row) => row.productionValidation.recallAt50))} | ${percent(weightedAverage(rows, (row) => row.validation.recallAt50))} | ${percent(weightedAverage(rows, (row) => row.productionValidation.contextRecallAt4096))} | ${percent(weightedAverage(rows, (row) => row.validation.contextRecallAt4096))} | ${percent(weightedAverage(rows, (row) => row.searchBaseline.validation.recallAt20))} | ${percent(weightedAverage(rows, (row) => row.searchBaseline.validation.contextRecallAt4096))} |`,
    )
  }

  lines.push(
    "",
    "## Evidence Router NDCG Holdouts",
    "",
    "These aggregate excluded-fold rows compare each fusion and objective with the current Production router under identical validation partitions.",
    "",
    "| Model | Fusion | Objective | Strategy | Production NDCG@5 | Dynamic NDCG@5 | Production NDCG@10 | Dynamic NDCG@10 | Production NDCG@20 | Dynamic NDCG@20 | Production NDCG@50 | Dynamic NDCG@50 |",
    "| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
  )
  for (const [key, rows] of routerGroups) {
    const [model, fusion, objective, strategy] = key.split("\0")
    lines.push(
      `| ${model} | ${fusion} | ${objective} | ${strategy} | ${percent(weightedAverage(rows, (row) => row.productionValidation.ndcgAt5))} | ${percent(weightedAverage(rows, (row) => row.validation.ndcgAt5))} | ${percent(weightedAverage(rows, (row) => row.productionValidation.ndcgAt10))} | ${percent(weightedAverage(rows, (row) => row.validation.ndcgAt10))} | ${percent(weightedAverage(rows, (row) => row.productionValidation.ndcgAt20))} | ${percent(weightedAverage(rows, (row) => row.validation.ndcgAt20))} | ${percent(weightedAverage(rows, (row) => row.productionValidation.ndcgAt50))} | ${percent(weightedAverage(rows, (row) => row.validation.ndcgAt50))} |`,
    )
  }

  const holdoutRows = [
    ...artifact.fusionSearch.flatMap((result) =>
      result.holdoutBreakdown.map((holdout) => ({
        model: result.model,
        fusion: result.fusion,
        objective: "static",
        strategy: result.strategy,
        fold: result.fold,
        holdout,
      })),
    ),
    ...artifact.evidenceRouterSearch.flatMap((result) =>
      result.holdoutBreakdown.map((holdout) => ({
        model: result.model,
        fusion: result.fusion,
        objective: result.objective,
        strategy: result.strategy,
        fold: result.fold,
        holdout,
      })),
    ),
  ]
  lines.push(
    "",
    "## Holdout Guardrail Breakdown",
    "",
    "These unweighted partitions expose the query-form and repository guardrails behind each selected candidate; the baseline is the current Production router on the same excluded samples.",
    "",
    "| Model | Fusion | Objective | Strategy | Fold | Partition | Queries | Guardrails | Candidate R@5 | Baseline R@5 | Candidate R@10 | Baseline R@10 | Candidate R@20 | Baseline R@20 | Candidate R@50 | Baseline R@50 | Candidate Ctx@4k | Baseline Ctx@4k |",
    "| --- | --- | --- | --- | --- | --- | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
  )
  for (const row of holdoutRows) {
    const holdout: HoldoutQuality = row.holdout
    lines.push(
      `| ${row.model} | ${row.fusion} | ${row.objective} | ${row.strategy} | ${row.fold} | ${holdout.dimension}:${holdout.name} | ${holdout.queries} | ${holdout.guardrailsMet ? "yes" : "no"} | ${percent(holdout.candidate.recallAt5)} | ${percent(holdout.baseline.recallAt5)} | ${percent(holdout.candidate.recallAt10)} | ${percent(holdout.baseline.recallAt10)} | ${percent(holdout.candidate.recallAt20)} | ${percent(holdout.baseline.recallAt20)} | ${percent(holdout.candidate.recallAt50)} | ${percent(holdout.baseline.recallAt50)} | ${percent(holdout.candidate.contextRecallAt4096)} | ${percent(holdout.baseline.contextRecallAt4096)} |`,
    )
  }

  lines.push(
    "",
    "### Holdout NDCG Breakdown",
    "",
    "| Model | Fusion | Objective | Strategy | Fold | Partition | Candidate NDCG@5 | Baseline NDCG@5 | Candidate NDCG@10 | Baseline NDCG@10 | Candidate NDCG@20 | Baseline NDCG@20 | Candidate NDCG@50 | Baseline NDCG@50 |",
    "| --- | --- | --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
  )
  for (const row of holdoutRows) {
    const holdout: HoldoutQuality = row.holdout
    lines.push(
      `| ${row.model} | ${row.fusion} | ${row.objective} | ${row.strategy} | ${row.fold} | ${holdout.dimension}:${holdout.name} | ${percent(holdout.candidate.ndcgAt5)} | ${percent(holdout.baseline.ndcgAt5)} | ${percent(holdout.candidate.ndcgAt10)} | ${percent(holdout.baseline.ndcgAt10)} | ${percent(holdout.candidate.ndcgAt20)} | ${percent(holdout.baseline.ndcgAt20)} | ${percent(holdout.candidate.ndcgAt50)} | ${percent(holdout.baseline.ndcgAt50)} |`,
    )
  }

  lines.push(...renderPromotionEvidence(artifact))

  lines.push(
    "",
    "## Recommended Evidence Router",
    "",
    "These scenario-specific candidates are fitted across all query forms only after grouped and repository holdouts have measured generalization.",
    "",
    "| Model | Fusion | Objective | Promotion | Samples | Proxy evals | Full evals | Static I/C/B/D/S | Dynamic base I/C/B/D/S | Influence Score/Geometry/TermCoverage/PairwiseAgreement/DenseConfidence/Identifier/Length | Static R@5 | Dynamic R@5 | Static R@10 | Dynamic R@10 | Static R@20 | Dynamic R@20 | Dynamic R@50 | Static Ctx@4k | Dynamic Ctx@4k |",
    "| --- | --- | --- | --- | ---: | ---: | ---: | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
  )
  for (const result of artifact.recommendedEvidenceRouters) {
    const { baseWeights, staticWeights, influences } = formatRouterWeightColumns(result)
    lines.push(
      `| ${result.model} | ${result.fusion} | ${result.objective} | ${promotionLabel(result.promotionStatus)} | ${result.samples} | ${result.proxyEvaluations} | ${result.fullEvaluations} | ${staticWeights} | ${baseWeights} | ${influences} | ${percent(result.staticQuality.recallAt5)} | ${percent(result.fitQuality.recallAt5)} | ${percent(result.staticQuality.recallAt10)} | ${percent(result.fitQuality.recallAt10)} | ${percent(result.staticQuality.recallAt20)} | ${percent(result.fitQuality.recallAt20)} | ${percent(result.fitQuality.recallAt50)} | ${percent(result.staticQuality.contextRecallAt4096)} | ${percent(result.fitQuality.contextRecallAt4096)} |`,
    )
  }

  return `${lines.join("\n")}\n`
}
