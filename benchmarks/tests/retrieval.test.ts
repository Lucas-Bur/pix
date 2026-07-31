import { expect, it } from "@effect/vitest"
import { Effect } from "effect"

import { runRetrievalBenchmark } from "../retrieval/runner.js"
import type { BenchmarkProfile } from "../retrieval/types.js"

const runProfile = (profile: BenchmarkProfile, groupedFolds: number, fusionMethods: number) =>
  Effect.gen(function* () {
    const { artifact, outputPath } = yield* runRetrievalBenchmark(profile)
    const repositoryHoldouts =
      (profile === "validate" || profile === "full") && artifact.repositories.length > 1
        ? artifact.repositories.length
        : 0
    const holdoutsPerModel = groupedFolds + repositoryHoldouts

    expect(artifact.benchmarkProfile).toBe(profile)
    expect(artifact.repositories.length).toBeGreaterThan(0)
    expect(artifact.models.length).toBeGreaterThan(0)
    expect(artifact.measurements.length).toBeGreaterThan(0)
    expect(artifact.schemaVersion).toBe(7)
    expect(artifact.fusionSearch.length).toBe(
      artifact.models.length * fusionMethods * holdoutsPerModel,
    )
    expect(artifact.recommendedFusionWeights.length).toBe(artifact.models.length * fusionMethods)
    expect(artifact.evidenceRouterSearch.length).toBe(artifact.models.length * holdoutsPerModel)
    expect(artifact.recommendedEvidenceRouters.length).toBe(artifact.models.length)
    expect(artifact.weightSearch.length === 0).toBe(profile !== "full")
    expect(artifact.recommendedWeights.length === 0).toBe(profile !== "full")
    expect(artifact.measurements.every((row) => row.recallAt20 >= row.recallAt10)).toBe(true)
    expect(artifact.measurements.every((row) => row.recallAt10 >= row.recallAt5)).toBe(true)
    expect(outputPath).toMatch(/benchmarks[\\/]results[\\/]retrieval-.*\.json$/)
  })

it.effect("runs the smoke retrieval profile", () => runProfile("smoke", 5, 1))

it.effect("runs the develop retrieval profile", () => runProfile("develop", 3, 1))

it.effect("runs the validate retrieval profile", () => runProfile("validate", 5, 1))

it.effect("runs the full retrieval profile", () => runProfile("full", 5, 3))
