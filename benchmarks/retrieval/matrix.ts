import { Schema } from "effect"

import type { FusionMethod } from "../../src/domain/retrieval.js"
import type { OptimizationProfile } from "./evaluation/optimization-profiles.js"
import type {
  BenchmarkArtifact,
  BenchmarkProfile,
  BenchmarkTimings,
  EvidenceRouterSearchResult,
  RouterObjective,
  RouterSearchDiagnostics,
  ValidationStrategy,
} from "./evaluation/types.js"

const BenchmarkProfileSchema = Schema.Literals(["smoke", "develop", "validate", "full"])
const ValidationStrategySchema = Schema.Literals([
  "grouped-3-fold",
  "grouped-5-fold",
  "leave-one-repository-out",
])
const FusionMethodSchema = Schema.Literals(["rrf", "relative-score", "dbsf"])
const RouterObjectiveSchema = Schema.Literals([
  "direct",
  "direct-recall-first",
  "reranker-top20",
  "reranker-top50",
])

/** One expected result coordinate in a mergeable retrieval benchmark matrix. */
export const BenchmarkMatrixCoordinateSchema = Schema.Struct({
  benchmarkProfile: BenchmarkProfileSchema,
  optimizationProfile: Schema.String,
  model: Schema.String,
  repository: Schema.String,
  fusion: FusionMethodSchema,
  objective: RouterObjectiveSchema,
  validationStrategy: ValidationStrategySchema,
  fold: Schema.String,
})

/** Explicit expected coverage for a set of independently generated benchmark artifacts. */
export const BenchmarkMatrixPlanSchema = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  coordinates: Schema.NonEmptyArray(BenchmarkMatrixCoordinateSchema),
})

const BenchmarkMatrixValidationAxisSchema = Schema.Struct({
  strategy: ValidationStrategySchema,
  folds: Schema.NonEmptyArray(Schema.String),
})

const BenchmarkMatrixRunSchema = Schema.Struct({
  benchmarkProfile: BenchmarkProfileSchema,
  optimizationProfiles: Schema.NonEmptyArray(Schema.String),
  models: Schema.NonEmptyArray(Schema.String),
  repositories: Schema.NonEmptyArray(Schema.String),
  fusions: Schema.NonEmptyArray(FusionMethodSchema),
  objectives: Schema.NonEmptyArray(RouterObjectiveSchema),
  validations: Schema.NonEmptyArray(BenchmarkMatrixValidationAxisSchema),
})

/** Versioned matrix manifest whose run axes expand to exact expected coordinates. */
export const BenchmarkMatrixManifestSchema = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  runs: Schema.NonEmptyArray(BenchmarkMatrixRunSchema),
})

/** Decoded benchmark matrix coordinate. */
export type BenchmarkMatrixCoordinate = typeof BenchmarkMatrixCoordinateSchema.Type

/** Decoded benchmark matrix coverage plan. */
export type BenchmarkMatrixPlan = typeof BenchmarkMatrixPlanSchema.Type

/** Decoded benchmark matrix run manifest. */
export type BenchmarkMatrixManifest = typeof BenchmarkMatrixManifestSchema.Type

/** One benchmark process invocation derived from a matrix run. */
export interface BenchmarkMatrixInvocation {
  readonly benchmarkProfile: BenchmarkProfile
  readonly optimizationProfile: string
  readonly model: string
  readonly repositories: readonly string[]
}

/** Minimum router result identity required to merge benchmark artifacts. */
export interface MatrixSearchResult {
  readonly model: string
  readonly fusion: FusionMethod
  readonly objective: RouterObjective
  readonly strategy: ValidationStrategy
  readonly fold: string
  readonly searchDiagnostics: RouterSearchDiagnostics
}

/** Artifact fields consumed by matrix validation and merging. */
export interface MatrixSourceArtifact<
  Result extends MatrixSearchResult = EvidenceRouterSearchResult,
> {
  readonly benchmarkProfile: BenchmarkProfile
  readonly optimizationProfile: Pick<OptimizationProfile, "name">
  readonly generatedAt: string
  readonly timings: BenchmarkTimings
  readonly repositories: BenchmarkArtifact["repositories"]
  readonly evidenceRouterSearch: readonly Result[]
}

/** One matrix coordinate with its complete router result and source timing record. */
export interface MergedBenchmarkMatrixEntry<
  Result extends MatrixSearchResult = EvidenceRouterSearchResult,
> {
  readonly coordinate: BenchmarkMatrixCoordinate
  readonly sourceGeneratedAt: string
  readonly sourceTimings: BenchmarkTimings
  readonly result: Result
}

/** Deterministic merge output after all expected coordinates pass coverage validation. */
export interface MergedBenchmarkMatrix<
  Result extends MatrixSearchResult = EvidenceRouterSearchResult,
> {
  readonly schemaVersion: 1
  readonly coordinates: readonly MergedBenchmarkMatrixEntry<Result>[]
}

/** Return the stable identity used for duplicate, missing, and unexpected-coordinate checks. */
export const benchmarkMatrixCoordinateKey = (coordinate: BenchmarkMatrixCoordinate): string =>
  JSON.stringify([
    coordinate.benchmarkProfile,
    coordinate.optimizationProfile,
    coordinate.model,
    coordinate.repository,
    coordinate.fusion,
    coordinate.objective,
    coordinate.validationStrategy,
    coordinate.fold,
  ])

/** Expand a compact run-axis manifest into deterministic result coordinates. */
export const expandBenchmarkMatrixManifest = (
  manifest: BenchmarkMatrixManifest,
): BenchmarkMatrixPlan => {
  const coordinates = manifest.runs.flatMap((run) =>
    run.optimizationProfiles.flatMap((optimizationProfile) =>
      run.models.flatMap((model) =>
        run.repositories.flatMap((repository) =>
          run.fusions.flatMap((fusion) =>
            run.objectives.flatMap((objective) =>
              run.validations.flatMap((validation) =>
                validation.folds.map((fold) => ({
                  benchmarkProfile: run.benchmarkProfile,
                  optimizationProfile,
                  model,
                  repository,
                  fusion,
                  objective,
                  validationStrategy: validation.strategy,
                  fold,
                })),
              ),
            ),
          ),
        ),
      ),
    ),
  )
  const first = coordinates[0]
  if (first === undefined) throw new Error("Benchmark matrix manifest expanded to no coordinates")
  return { schemaVersion: 1, coordinates: [first, ...coordinates.slice(1)] }
}

/** Return the benchmark process invocations needed to produce every manifest coordinate. */
export const benchmarkMatrixInvocations = (
  manifest: BenchmarkMatrixManifest,
): readonly BenchmarkMatrixInvocation[] =>
  manifest.runs.flatMap((run) =>
    run.optimizationProfiles.flatMap((optimizationProfile) =>
      run.models.map((model) => ({
        benchmarkProfile: run.benchmarkProfile,
        optimizationProfile,
        model,
        repositories: run.repositories,
      })),
    ),
  )

/** Restrict a plan to the coordinates covered by successful invocations. */
export const restrictBenchmarkMatrixPlan = (
  plan: BenchmarkMatrixPlan,
  covered: ReadonlySet<string>,
): BenchmarkMatrixPlan => {
  const coordinates = plan.coordinates.filter((coordinate) =>
    covered.has(
      `${coordinate.benchmarkProfile}\0${coordinate.optimizationProfile}\0${coordinate.model}`,
    ),
  )
  if (coordinates.length === 0)
    throw new Error("Benchmark matrix plan restriction removed every coordinate")
  return { schemaVersion: 1, coordinates } as unknown as BenchmarkMatrixPlan
}

/** Stable identity of one matrix invocation. */
export const benchmarkMatrixInvocationKey = (invocation: BenchmarkMatrixInvocation): string =>
  `${invocation.benchmarkProfile}\0${invocation.optimizationProfile}\0${invocation.model}`

const coordinateFor = <Result extends MatrixSearchResult>(
  artifact: MatrixSourceArtifact<Result>,
  result: Result,
  repository: string,
): BenchmarkMatrixCoordinate => ({
  benchmarkProfile: artifact.benchmarkProfile,
  optimizationProfile: artifact.optimizationProfile.name,
  model: result.model,
  repository,
  fusion: result.fusion,
  objective: result.objective,
  validationStrategy: result.strategy,
  fold: result.fold,
})

/** Expand every artifact result across the repositories that participated in its search. */
export const benchmarkMatrixCoordinates = <Result extends MatrixSearchResult>(
  artifact: MatrixSourceArtifact<Result>,
): readonly BenchmarkMatrixCoordinate[] =>
  artifact.evidenceRouterSearch.flatMap((result) =>
    artifact.repositories.map((repository) => coordinateFor(artifact, result, repository.id)),
  )

const uniquePlanCoordinates = (
  plan: BenchmarkMatrixPlan,
): ReadonlyMap<string, BenchmarkMatrixCoordinate> => {
  const coordinates = new Map<string, BenchmarkMatrixCoordinate>()
  for (const coordinate of plan.coordinates) {
    const key = benchmarkMatrixCoordinateKey(coordinate)
    if (coordinates.has(key)) throw new Error(`Duplicate benchmark matrix plan coordinate: ${key}`)
    coordinates.set(key, coordinate)
  }
  return coordinates
}

/** Merge artifact rows according to an explicit plan and reject incomplete or overlapping coverage. */
export const mergeBenchmarkMatrix = <Result extends MatrixSearchResult>(
  plan: BenchmarkMatrixPlan,
  artifacts: readonly MatrixSourceArtifact<Result>[],
): MergedBenchmarkMatrix<Result> => {
  const expected = uniquePlanCoordinates(plan)
  const discovered = new Map<string, MergedBenchmarkMatrixEntry<Result>>()

  for (const artifact of artifacts) {
    for (const result of artifact.evidenceRouterSearch) {
      for (const repository of artifact.repositories) {
        const coordinate = coordinateFor(artifact, result, repository.id)
        const key = benchmarkMatrixCoordinateKey(coordinate)
        if (discovered.has(key)) throw new Error(`Duplicate benchmark artifact coordinate: ${key}`)
        if (!expected.has(key)) throw new Error(`Unexpected benchmark artifact coordinate: ${key}`)
        discovered.set(key, {
          coordinate,
          sourceGeneratedAt: artifact.generatedAt,
          sourceTimings: artifact.timings,
          result,
        })
      }
    }
  }

  const missing = [...expected.keys()].filter((key) => !discovered.has(key))
  if (missing.length > 0)
    throw new Error(`Missing benchmark artifact coordinates: ${missing.join(", ")}`)

  return {
    schemaVersion: 1,
    coordinates: [...discovered]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([, row]) => row),
  }
}
