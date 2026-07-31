import { expect, it } from "@effect/vitest"
import { Effect } from "effect"

import { runRetrievalBenchmark } from "../retrieval/runner.js"

it.effect("writes retrieval quality measurements for every selected matrix cell", () =>
  Effect.gen(function* () {
    const { artifact, outputPath } = yield* runRetrievalBenchmark()
    expect(artifact.repositories.length).toBeGreaterThan(0)
    expect(artifact.models.length).toBeGreaterThan(0)
    expect(artifact.measurements.length).toBeGreaterThan(0)
    expect(artifact.schemaVersion).toBe(5)
    expect(artifact.evidenceRouterSearch.length).toBeGreaterThan(0)
    expect(artifact.recommendedEvidenceRouters.length).toBe(artifact.models.length)
    expect(artifact.measurements.every((row) => row.recallAt20 >= row.recallAt10)).toBe(true)
    expect(artifact.measurements.every((row) => row.recallAt10 >= row.recallAt5)).toBe(true)
    expect(outputPath).toMatch(/benchmarks[\\/]results[\\/]retrieval-.*\.json$/)
  }),
)
