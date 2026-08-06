import { Schema } from "effect"

import type {
  EvidenceRouterConfig,
  FusionMethod as ProductionFusionMethod,
} from "../../../src/domain/retrieval.js"
import type { OptimizationProfile } from "./optimization-profiles.js"

/** Benchmark repository size band used for report segmentation. */
const RepositorySizeSchema = Schema.Literals(["small", "medium", "large"])

/** Exact file-qualified symbol expected to be retrieved for one question. */
const GoldLocationSchema = Schema.Struct({
  file: Schema.String,
  symbol: Schema.String,
})

/** Four representations of the same repository-navigation intent. */
const QueryFormsSchema = Schema.Struct({
  identifier: Schema.String,
  searchPhrase: Schema.String,
  naturalQuestion: Schema.String,
  agentTask: Schema.String,
})

/** One authored retrieval question and its exact ground-truth locations. */
const BenchmarkQuestionSchema = Schema.Struct({
  id: Schema.String,
  queries: QueryFormsSchema,
  category: Schema.String,
  difficulty: Schema.Literals(["easy", "medium", "hard"]),
  groundTruth: Schema.Array(GoldLocationSchema),
})

/** Versioned manifest for one pinned real-world benchmark repository. */
export const CorpusManifestSchema = Schema.Struct({
  schemaVersion: Schema.Literal(2),
  id: Schema.String,
  repository: Schema.String,
  revision: Schema.String,
  language: Schema.String,
  size: RepositorySizeSchema,
  includeRoots: Schema.Array(Schema.String),
  excludePaths: Schema.Array(Schema.String),
  extensions: Schema.Array(Schema.String),
  questions: Schema.Array(BenchmarkQuestionSchema),
})

/** Decoded benchmark corpus manifest. */
export type CorpusManifest = typeof CorpusManifestSchema.Type

/** Decoded exact ground-truth location. */
export type GoldLocation = typeof GoldLocationSchema.Type

/** Query representation categories evaluated independently. */
export type QueryKind = keyof typeof QueryFormsSchema.Type

/** Score or rank fusion algorithm evaluated with independently tuned channel weights. */
type FusionMethod = ProductionFusionMethod

/** Product retrieval scenario used to choose a router candidate. */
export const ROUTER_OBJECTIVES = ["direct", "reranker-top20", "reranker-top50"] as const
export type RouterObjective = (typeof ROUTER_OBJECTIVES)[number]

/** Versioned evidence-router search strategies recorded in benchmark artifacts. */
export const ROUTER_SEARCH_STRATEGIES = {
  "proxy-promotion": {
    algorithm: "halton-global-scout-elitist-beam-proxy-promotion",
    globalScouts: 64,
    beamWidth: 6,
    coordinatePasses: 2,
    candidateDepth: 200,
    proxySampleFraction: 0.25,
    proxyMinimumSamples: 32,
    proxyPromotionFactor: 8,
    objectives: ROUTER_OBJECTIVES,
    guardrailTolerance: 0.01,
    seed: 0,
    normalization: "per-channel-max-weight",
    tieBreaking: "guardrails>objective>complexity>stable-key",
  },
  "successive-halving": {
    algorithm: "halton-global-scout-elitist-beam-successive-halving",
    globalScouts: 64,
    beamWidth: 6,
    coordinatePasses: 2,
    candidateDepth: 200,
    proxySampleFraction: 0.25,
    proxyMinimumSamples: 32,
    halvingKeepFactor: 8,
  },
} as const

export type RouterSearchStrategyName = keyof typeof ROUTER_SEARCH_STRATEGIES
export type RouterSearchStrategy = (typeof ROUTER_SEARCH_STRATEGIES)[RouterSearchStrategyName]

export const DEFAULT_ROUTER_SEARCH_STRATEGY: RouterSearchStrategyName = "proxy-promotion"
export const ROUTER_SEARCH_STRATEGY = ROUTER_SEARCH_STRATEGIES[DEFAULT_ROUTER_SEARCH_STRATEGY]

/** Runtime/coverage trade-off selected for one benchmark invocation. */
export type BenchmarkProfile = "smoke" | "develop" | "validate" | "full"

/** Holdout partition used to evaluate selected benchmark parameters. */
export type ValidationStrategy = "grouped-3-fold" | "grouped-5-fold" | "leave-one-repository-out"

/** Retrieval configurations evaluated against identical chunks and queries. */
export type RetrievalVariant =
  | "identity"
  | "camelcase"
  | "bm25"
  | "dense"
  | "sparse"
  | "identifiers"
  | "identity+bm25"
  | "identity+dense"
  | "camelcase+bm25"
  | "camelcase+dense"
  | "bm25+dense"
  | "identifiers+sparse"
  | "bm25+sparse"
  | "dense+sparse"
  | "rrf-equal"
  | "rrf"
  | "rrf-no-sparse"
  | "rrf-no-identity"
  | "rrf-no-camelcase"
  | "rrf-no-bm25"
  | "rrf-no-dense"

/** One query-level metric row in a benchmark artifact. */
export interface QueryMeasurement {
  readonly repository: string
  readonly language: string
  readonly size: typeof RepositorySizeSchema.Type
  readonly revision: string
  readonly model: string
  readonly variant: RetrievalVariant
  readonly questionId: string
  readonly queryKind: QueryKind
  readonly query: string
  readonly category: string
  readonly difficulty: "easy" | "medium" | "hard"
  readonly groupedFold: number
  readonly recallAt5: number
  readonly recallAt10: number
  readonly recallAt20: number
  readonly recallAt50: number
  readonly successAt10: boolean
  readonly successAt20: boolean
  readonly reciprocalRank: number
  readonly goldRanks: readonly (number | null)[]
  readonly contextRecall: Readonly<Record<string, number>>
  readonly queryDurationMs: number
}

/** Static fusion weights searched for one model and query representation. */
interface ChannelWeights {
  readonly identity: number
  readonly camelcase: number
  readonly bm25: number
  readonly dense: number
  readonly sparse: number
}

/** Aggregate quality objective used for development and holdout evaluation. */
export interface QualitySummary {
  readonly recallAt5: number
  readonly recallAt10: number
  readonly recallAt20: number
  readonly recallAt50: number
  readonly contextRecallAt4096: number
  readonly meanReciprocalRank: number
}

/** Quality field that can participate in candidate selection or deployment guardrails. */
export type QualityMetric = keyof QualitySummary

/** Whether a benchmark candidate is eligible for production promotion. */
export type PromotionStatus = "eligible" | "no-eligible-candidate"

/** Exact reason why one candidate failed a deployment guardrail. */
export interface GuardrailBlocker {
  readonly partition: "aggregate" | "query-form" | "repository"
  readonly name: string
  readonly metric: QualityMetric
  readonly candidateValue: number
  readonly baselineValue: number
  readonly tolerance: number
  readonly delta: number
}

/** Quality and guardrail outcome for one query-form or repository holdout partition. */
export interface HoldoutQuality {
  readonly dimension: GuardrailBlocker["partition"]
  readonly name: string
  readonly queries: number
  readonly candidate: QualitySummary
  readonly baseline: QualitySummary
  readonly guardrailsMet: boolean
  readonly blockers: readonly GuardrailBlocker[]
}

/** Bootstrap interval for a paired candidate-minus-baseline holdout delta. */
export interface HoldoutUncertainty {
  readonly strategy: ValidationStrategy
  readonly partition: GuardrailBlocker["partition"]
  readonly name: string
  readonly metric: QualityMetric
  readonly meanDelta: number
  readonly lowerBound: number
  readonly upperBound: number
  readonly bootstrapSamples: number
}

/** Empirical robustness of independently selected candidates across excluded folds. */
export interface CandidateStability {
  readonly folds: number
  readonly distinctSelections: number
  readonly selectionFrequency: number
  readonly localPerturbations: number
  readonly plateauWidth: number
  readonly epsilonNeighborFraction: number
  readonly medianHoldoutDrop: number
  readonly worstCaseHoldoutDrop: number
  readonly seeds: number
  readonly restarts: number
}

/** Holdout-only decision attached to a diagnostic fit-all router candidate. */
export interface PromotionEvidence {
  readonly model: string
  readonly fusion: FusionMethod
  readonly objective: RouterObjective
  readonly promotionStatus: PromotionStatus
  readonly missingStrategies: readonly ValidationStrategy[]
  readonly finalTest: {
    readonly strategy: ValidationStrategy
    readonly fold: string
    readonly present: boolean
    readonly guardrailsMet: boolean
  }
  readonly blockers: ReadonlyArray<
    GuardrailBlocker & { readonly strategy: ValidationStrategy; readonly fold: string }
  >
  readonly uncertainty: readonly HoldoutUncertainty[]
  readonly stability: CandidateStability
}

/** One cross-validation fold with weights selected without its validation samples. */
export interface WeightSearchResult {
  readonly model: string
  readonly queryKind: QueryKind
  readonly strategy: ValidationStrategy
  readonly fold: string
  readonly developmentQueries: number
  readonly validationQueries: number
  readonly weights: ChannelWeights
  readonly development: QualitySummary
  readonly validation: QualitySummary
  readonly shapleyRecallAt20: ChannelWeights
}

/** Deployment candidate fitted on all available samples after cross-validation. */
export interface RecommendedWeights {
  readonly model: string
  readonly queryKind: QueryKind
  readonly samples: number
  readonly weights: ChannelWeights
  readonly fitQuality: QualitySummary
}

/** Static fusion weights selected without one validation fold. */
export interface FusionSearchResult {
  readonly model: string
  readonly fusion: FusionMethod
  readonly strategy: ValidationStrategy
  readonly fold: string
  readonly developmentQueries: number
  readonly validationQueries: number
  readonly weights: ChannelWeights
  readonly development: QualitySummary
  readonly validation: QualitySummary
  readonly guardrailsMet: boolean
  readonly promotionStatus: PromotionStatus
  readonly holdoutBreakdown: readonly HoldoutQuality[]
}

/** Holdout evaluation of the current production router used as the benchmark guardrail. */
export interface ProductionRouterSearchResult {
  readonly model: string
  readonly strategy: ValidationStrategy
  readonly fold: string
  readonly developmentQueries: number
  readonly validationQueries: number
  readonly development: QualitySummary
  readonly validation: QualitySummary
}

/** Static fusion candidate fitted on all query forms after holdout evaluation. */
export interface RecommendedFusionWeights {
  readonly model: string
  readonly fusion: FusionMethod
  readonly samples: number
  readonly weights: ChannelWeights
  readonly fitQuality: QualitySummary
  readonly guardrailsMet: boolean
  readonly promotionStatus: PromotionStatus
}

/** Search accounting needed to interpret a router candidate and its budget. */
export interface RouterSearchTimings {
  /** Time spent preparing evidence, baselines, and proxy samples. */
  readonly preparationMs: number
  /** Time spent preparing candidate snapshots and starting their evaluation pool. */
  readonly candidatePoolInitializationMs: number
  /** Time spent selecting the initial static/base weight seeds. */
  readonly baseWeightSearchMs: number
  /** Time spent evaluating the random scout baseline. */
  readonly randomSearchMs: number
  /** Time spent in initial and coordinate beam rounds. */
  readonly beamSearchMs: number
  /** Time spent converting router configs into evaluator candidates. */
  readonly candidatePreparationMs: number
  /** Wall time waiting for candidate evaluation results. */
  readonly candidateEvaluationMs: number
  /** Time spent ranking, selecting, and archiving evaluated candidates. */
  readonly candidateSelectionMs: number
}

/** Search diagnostics and timing breakdown for one router search. */
export interface RouterSearchDiagnostics {
  readonly parameterCount: number
  readonly parameterLevels: Readonly<Record<string, readonly number[]>>
  readonly rawCandidates: number
  readonly uniqueCandidates: number
  readonly proxyEvaluations: number
  readonly fullEvaluations: number
  readonly proxyCacheHits: number
  readonly fullCacheHits: number
  readonly proxyPromotions: number
  readonly proxyFullAgreement: number
  readonly protectedEliteCount: number
  readonly timings: RouterSearchTimings
}

/** Holdout comparison against a deterministic random-search baseline. */
export interface SearchBaselineComparison {
  readonly algorithm: "random-scout" | "not-run"
  readonly seed: number
  readonly candidates: number
  readonly development: QualitySummary
  readonly validation: QualitySummary
}

/** Explicit separation between candidate selection, holdouts, and final promotion evidence. */
export interface ValidationProtocol {
  readonly selection: "development-only"
  readonly holdouts: readonly ValidationStrategy[]
  readonly finalTest: {
    readonly kind: "untouched-grouped-fold"
    readonly strategy: ValidationStrategy
    readonly fold: string
  }
}

/** One holdout evaluation of a router selected from query and channel evidence. */
export interface EvidenceRouterSearchResult {
  readonly model: string
  readonly fusion: FusionMethod
  readonly objective: RouterObjective
  readonly strategy: ValidationStrategy
  readonly fold: string
  readonly developmentQueries: number
  readonly validationQueries: number
  readonly staticWeights: ChannelWeights
  readonly config: EvidenceRouterConfig
  readonly staticDevelopment: QualitySummary
  readonly staticValidation: QualitySummary
  readonly development: QualitySummary
  readonly validation: QualitySummary
  readonly productionDevelopment: QualitySummary
  readonly productionValidation: QualitySummary
  readonly guardrailsMet: boolean
  readonly promotionStatus: PromotionStatus
  readonly proxyEvaluations: number
  readonly fullEvaluations: number
  readonly searchDiagnostics: RouterSearchDiagnostics
  readonly searchBaseline: SearchBaselineComparison
  readonly holdoutBreakdown: readonly HoldoutQuality[]
}

/** Evidence-router candidate fitted on all samples after holdout evaluation. */
export interface RecommendedEvidenceRouter {
  readonly model: string
  readonly fusion: FusionMethod
  readonly objective: RouterObjective
  readonly samples: number
  readonly staticWeights: ChannelWeights
  readonly config: EvidenceRouterConfig
  readonly staticQuality: QualitySummary
  readonly fitQuality: QualitySummary
  readonly productionQuality: QualitySummary
  readonly guardrailsMet: boolean
  readonly promotionStatus: PromotionStatus
  readonly proxyEvaluations: number
  readonly fullEvaluations: number
  readonly searchDiagnostics: RouterSearchDiagnostics
}

/** Compute-time breakdown for one benchmark invocation, excluding artifact file serialization. */
export interface BenchmarkTimings {
  readonly totalDurationMs: number
  readonly corpusPreparationDurationMs: number
  readonly embeddingDurationMs: number
  readonly retrievalDurationMs: number
  readonly weightSearchDurationMs: number
  readonly fusionSearchDurationMs: number
  readonly evidenceRouterSearchDurationMs: number
  /** Time spent starting the shared native candidate queue. */
  readonly candidateQueueStartupDurationMs: number
  /** Time spent shutting down the shared native candidate queue. */
  readonly candidateQueueShutdownDurationMs: number
}

/** Reproducible machine-readable output of one complete benchmark run. */
export interface BenchmarkArtifact {
  readonly schemaVersion: 25
  /** Profile controlling benchmark coverage without changing retrieval behavior. */
  readonly benchmarkProfile: BenchmarkProfile
  /** Versioned objective profile used for candidate selection and aggregate metrics. */
  readonly optimizationProfile: OptimizationProfile
  readonly validationProtocol: ValidationProtocol
  readonly generatedAt: string
  readonly searchStrategy: RouterSearchStrategy
  readonly timings: BenchmarkTimings
  readonly chunkConfig: {
    readonly chunkTokens: number
    readonly overlapLines: number
  }
  readonly contextTokenEstimator: "utf8-bytes-divided-by-four"
  readonly contextBudgets: readonly number[]
  readonly models: readonly string[]
  readonly repositories: ReadonlyArray<{
    readonly id: string
    readonly repository: string
    readonly revision: string
    readonly chunks: number
    readonly preparationDurationMs: number
  }>
  /** Authored queries and exact file-qualified ground truth used for every retrieval variant. */
  readonly evaluationCases: ReadonlyArray<{
    readonly repository: string
    readonly questionId: string
    readonly queries: CorpusManifest["questions"][number]["queries"]
    readonly groundTruth: readonly GoldLocation[]
  }>
  readonly embeddingRuns: ReadonlyArray<{
    readonly repository: string
    readonly model: string
    readonly device: string
    readonly batchSize: number
    readonly chunkEmbeddingDurationMs: number
    readonly queryEmbeddingDurationMs: number
  }>
  readonly sparseEmbeddingRuns: ReadonlyArray<{
    readonly repository: string
    readonly model: string
    readonly tokenizerModel: string
    readonly batchSize: number
    readonly chunkEmbeddingDurationMs: number
    readonly queryTokenizationDurationMs: number
  }>
  readonly measurements: readonly QueryMeasurement[]
  readonly weightSearch: readonly WeightSearchResult[]
  readonly recommendedWeights: readonly RecommendedWeights[]
  readonly productionRouterSearch: readonly ProductionRouterSearchResult[]
  readonly fusionSearch: readonly FusionSearchResult[]
  readonly recommendedFusionWeights: readonly RecommendedFusionWeights[]
  readonly evidenceRouterSearch: readonly EvidenceRouterSearchResult[]
  readonly recommendedEvidenceRouters: readonly RecommendedEvidenceRouter[]
  readonly promotionEvidence: readonly PromotionEvidence[]
}
