import { Schema } from "effect"

import type { EvidenceRouterConfig } from "./evidence-router.js"

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
export type FusionMethod = "rrf" | "relative-score" | "dbsf"

/** Product retrieval scenario used to choose a router candidate. */
export const ROUTER_OBJECTIVES = ["direct", "reranker-top20", "reranker-top50"] as const
export type RouterObjective = (typeof ROUTER_OBJECTIVES)[number]

/** Versioned evidence-router search strategy recorded in every benchmark artifact. */
export const ROUTER_SEARCH_STRATEGY = {
  algorithm: "halton-global-scout-elitist-beam-successive-halving-pareto",
  globalScouts: 64,
  beamWidth: 6,
  coordinatePasses: 2,
  candidateDepth: 200,
  proxySampleFraction: 0.25,
  proxyMinimumSamples: 32,
  halvingKeepFactor: 8,
  objectives: ROUTER_OBJECTIVES,
  guardrailTolerance: 0.01,
} as const

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
  | "rrf"
  | "rrf+sparse"
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
export interface ChannelWeights {
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
}

/** Holdout evaluation of the current production RRF query-routing weights. */
export interface ProductionRrfSearchResult {
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
  readonly proxyEvaluations: number
  readonly fullEvaluations: number
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
  readonly proxyEvaluations: number
  readonly fullEvaluations: number
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
}

/** Reproducible machine-readable output of one complete benchmark run. */
export interface BenchmarkArtifact {
  readonly schemaVersion: 17
  /** Profile controlling benchmark coverage without changing retrieval behavior. */
  readonly benchmarkProfile: BenchmarkProfile
  readonly generatedAt: string
  readonly searchStrategy: typeof ROUTER_SEARCH_STRATEGY
  readonly timings: BenchmarkTimings
  readonly chunkConfig: {
    readonly chunkLines: number
    readonly overlapLines: number
    readonly minChunkChars: number
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
  readonly embeddingRuns: ReadonlyArray<{
    readonly repository: string
    readonly model: string
    readonly device: string
    readonly batchSize: number
    readonly chunkEmbeddingDurationMs: number
    readonly queryEmbeddingDurationMs: number
    readonly cacheHit: boolean
  }>
  readonly sparseEmbeddingRuns: ReadonlyArray<{
    readonly repository: string
    readonly model: string
    readonly tokenizerModel: string
    readonly device: string
    readonly batchSize: number
    readonly modelLoadDurationMs: number
    readonly chunkEmbeddingDurationMs: number
    readonly queryEmbeddingDurationMs: number
    readonly cacheHit: boolean
  }>
  readonly measurements: readonly QueryMeasurement[]
  readonly weightSearch: readonly WeightSearchResult[]
  readonly recommendedWeights: readonly RecommendedWeights[]
  readonly productionRrfSearch: readonly ProductionRrfSearchResult[]
  readonly fusionSearch: readonly FusionSearchResult[]
  readonly recommendedFusionWeights: readonly RecommendedFusionWeights[]
  readonly evidenceRouterSearch: readonly EvidenceRouterSearchResult[]
  readonly recommendedEvidenceRouters: readonly RecommendedEvidenceRouter[]
}
