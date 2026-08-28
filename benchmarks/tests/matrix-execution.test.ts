import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"

import { expect, it } from "@effect/vitest"
import { Effect, Result, Schema } from "effect"

import type { BenchmarkArtifact } from "../retrieval/evaluation/types.js"
import {
  benchmarkMatrixInvocationKey,
  benchmarkMatrixInvocations,
  BenchmarkMatrixManifestSchema,
  expandBenchmarkMatrixManifest,
  mergeBenchmarkMatrix,
  restrictBenchmarkMatrixPlan,
} from "../retrieval/matrix.js"
import { runRetrievalBenchmark } from "../retrieval/runner.js"

const readManifest = Effect.tryPromise({
  try: async () => {
    const input: unknown = JSON.parse(await readFile("benchmarks/matrix/full.json", "utf8"))
    return Schema.decodeUnknownSync(BenchmarkMatrixManifestSchema)(input)
  },
  catch: (cause) => new Error("Could not read the benchmark matrix manifest", { cause }),
})

it.effect(
  "executes and merges the complete retrieval matrix",
  () =>
    Effect.gen(function* () {
      const manifest = yield* readManifest
      const artifacts: BenchmarkArtifact[] = []
      const covered = new Set<string>()
      const failures: { readonly invocation: string; readonly error: string }[] = []

      for (const invocation of benchmarkMatrixInvocations(manifest)) {
        process.env.PIX_BENCH_MODELS = invocation.model
        process.env.PIX_BENCH_REPOS = invocation.repositories.join(",")
        process.env.PIX_BENCH_OPTIMIZATION_PROFILE = invocation.optimizationProfile
        const outcome = yield* Effect.result(runRetrievalBenchmark(invocation.benchmarkProfile))
        if (Result.isFailure(outcome)) {
          const cause = outcome.failure
          const error = cause instanceof Error ? cause.message : String(cause)
          failures.push({ invocation: benchmarkMatrixInvocationKey(invocation), error })
          continue
        }
        artifacts.push(outcome.success.artifact)
        covered.add(benchmarkMatrixInvocationKey(invocation))
      }

      const plan = restrictBenchmarkMatrixPlan(expandBenchmarkMatrixManifest(manifest), covered)
      const matrix = mergeBenchmarkMatrix(plan, artifacts)
      const outputDirectory = path.resolve("benchmarks/results")
      const outputPath = path.join(
        outputDirectory,
        `retrieval-matrix-${new Date().toISOString().replaceAll(":", "-")}.json`,
      )
      yield* Effect.tryPromise({
        try: async () => {
          await mkdir(outputDirectory, { recursive: true })
          await writeFile(
            outputPath,
            `${JSON.stringify({ ...matrix, failures }, null, 2)}\n`,
            "utf8",
          )
        },
        catch: (cause) => new Error(`Could not write benchmark matrix ${outputPath}`, { cause }),
      })

      expect(matrix.coordinates).toHaveLength(plan.coordinates.length)
      expect(artifacts.length).toBeGreaterThan(0)
    }),
  // The full 30-invocation matrix is a multi-hour release-evidence run.
  7 * 24 * 3_600_000,
)
