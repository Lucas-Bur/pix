import { expect, it } from "@effect/vitest"
import { Effect } from "effect"

import { assignGroupedFolds } from "../retrieval/folds.js"
import { runRetrievalBenchmark } from "../retrieval/runner.js"
import type { BenchmarkProfile } from "../retrieval/types.js"

const foldQuestions = (prefix: string) =>
  Array.from({ length: 12 }, (_, index) => ({
    id: `${prefix}-${index + 1}`,
    queries: {
      identifier: "",
      searchPhrase: "",
      naturalQuestion: "",
      agentTask: "",
    },
    category: ["architecture", "routing", "symbol-lookup"][Math.floor(index / 4)],
    difficulty: ["easy", "medium", "hard"][index % 3] as "easy" | "medium" | "hard",
    groundTruth: [],
  }))

type TestQuestion = ReturnType<typeof foldQuestions>[number]
type TestManifest = { readonly id: string; readonly questions: readonly TestQuestion[] }

const expectBalancedClass = (
  manifest: TestManifest,
  assignments: ReadonlyMap<string, number>,
  className: string,
  select: (question: TestQuestion) => string,
): void => {
  const counts = [0, 0, 0]
  for (const question of manifest.questions) {
    if (select(question) !== className) continue
    const fold = assignments.get(`${manifest.id}\0${question.id}`)
    if (fold === undefined) throw new Error(`Missing fold for ${question.id}`)
    counts[fold]++
  }
  expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1)
}

const expectStratifiedClasses = (
  manifests: readonly TestManifest[],
  assignments: ReadonlyMap<string, number>,
): void => {
  const categories = ["architecture", "routing", "symbol-lookup"]
  const difficulties = ["easy", "medium", "hard"]
  const checks = manifests.flatMap((manifest) => [
    ...categories.map((className) => ({
      manifest,
      className,
      select: (question: TestQuestion) => question.category,
    })),
    ...difficulties.map((className) => ({
      manifest,
      className,
      select: (question: TestQuestion) => question.difficulty,
    })),
  ])
  for (const check of checks)
    expectBalancedClass(check.manifest, assignments, check.className, check.select)
}

const runProfile = (profile: BenchmarkProfile, groupedFolds: number, fusionMethods: number) =>
  Effect.gen(function* () {
    const { artifact, outputPath } = yield* runRetrievalBenchmark(profile)
    const repositoryHoldouts =
      (profile === "validate" || profile === "full") && artifact.repositories.length > 1
        ? artifact.repositories.length
        : 0
    const holdoutsPerModel = groupedFolds + repositoryHoldouts
    const routerFusionMethods = profile === "full" ? 3 : 1

    expect(artifact.benchmarkProfile).toBe(profile)
    expect(artifact.repositories.length).toBeGreaterThan(0)
    expect(artifact.models.length).toBeGreaterThan(0)
    expect(artifact.measurements.length).toBeGreaterThan(0)
    expect(artifact.schemaVersion).toBe(13)
    expect(artifact.fusionSearch.length).toBe(
      artifact.models.length * fusionMethods * holdoutsPerModel,
    )
    expect(artifact.recommendedFusionWeights.length).toBe(artifact.models.length * fusionMethods)
    expect(artifact.evidenceRouterSearch.length).toBe(
      artifact.models.length * routerFusionMethods * holdoutsPerModel,
    )
    expect(new Set(artifact.evidenceRouterSearch.map((row) => row.fusion)).size).toBe(
      routerFusionMethods,
    )
    expect(artifact.recommendedEvidenceRouters.length).toBe(
      artifact.models.length * routerFusionMethods,
    )
    expect(artifact.weightSearch.length).toBe(0)
    expect(artifact.recommendedWeights.length).toBe(0)
    expect(artifact.measurements.every((row) => row.recallAt20 >= row.recallAt10)).toBe(true)
    expect(artifact.measurements.every((row) => row.recallAt10 >= row.recallAt5)).toBe(true)
    expect(outputPath).toMatch(/benchmarks[\\/]results[\\/]retrieval-.*\.json$/)
  })

it.effect("runs the smoke retrieval profile", () => runProfile("smoke", 5, 1))

it.effect("runs the develop retrieval profile", () => runProfile("develop", 3, 1))

it.effect("runs the validate retrieval profile", () => runProfile("validate", 5, 1))

it.effect("runs the full retrieval profile", () => runProfile("full", 5, 3))

it("shuffles intent groups deterministically before assigning folds", () => {
  const manifests = [
    { id: "first", questions: foldQuestions("first") },
    { id: "second", questions: foldQuestions("second") },
  ]
  const reordered = manifests
    .map((manifest) => ({
      ...manifest,
      questions: [...manifest.questions].reverse(),
    }))
    .reverse()
  const assignments = assignGroupedFolds(manifests, 3)
  const reorderedAssignments = assignGroupedFolds(reordered, 3)
  const sortedEntries = (map: ReadonlyMap<string, number>) =>
    [...map.entries()].sort(([left], [right]) => left.localeCompare(right))

  expect(sortedEntries(assignments)).toEqual(sortedEntries(reorderedAssignments))
  expect([...assignments.values()].sort((left, right) => left - right)).toEqual([
    0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2, 2, 2,
  ])

  expectStratifiedClasses(manifests, assignments)
})
