import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"

import { expect, it } from "@effect/vitest"
import { Effect, Schema } from "effect"

import type { BenchmarkArtifact } from "../retrieval/evaluation/types.js"
import {
  benchmarkMatrixInvocations,
  BenchmarkMatrixManifestSchema,
  expandBenchmarkMatrixManifest,
  mergeBenchmarkMatrix,
} from "../retrieval/matrix.js"
import { runRetrievalBenchmark } from "../retrieval/runner.js"

const readManifest = Effect.tryPromise({
  try: async () => {
    const input: unknown = JSON.parse(await readFile("benchmarks/matrix/full.json", "utf8"))
    return Schema.decodeUnknownSync(BenchmarkMatrixManifestSchema)(input)
  },
  catch: (cause) => new Error("Could not read the benchmark matrix manifest", { cause }),
})

it.effect("executes and merges the complete retrieval matrix", () =>
  Effect.gen(function* () {
    const manifest = yield* readManifest
    const artifacts: BenchmarkArtifact[] = []

    for (const invocation of benchmarkMatrixInvocations(manifest)) {
      process.env.PIX_BENCH_MODELS = invocation.model
      process.env.PIX_BENCH_REPOS = invocation.repositories.join(",")
      process.env.PIX_BENCH_OPTIMIZATION_PROFILE = invocation.optimizationProfile
      const result = yield* runRetrievalBenchmark(invocation.benchmarkProfile)
      artifacts.push(result.artifact)
    }

    const plan = expandBenchmarkMatrixManifest(manifest)
    const matrix = mergeBenchmarkMatrix(plan, artifacts)
    const outputDirectory = path.resolve("benchmarks/results")
    const outputPath = path.join(
      outputDirectory,
      `retrieval-matrix-${new Date().toISOString().replaceAll(":", "-")}.json`,
    )
    yield* Effect.tryPromise({
      try: async () => {
        await mkdir(outputDirectory, { recursive: true })
        await writeFile(outputPath, `${JSON.stringify(matrix, null, 2)}\n`, "utf8")
      },
      catch: (cause) => new Error(`Could not write benchmark matrix ${outputPath}`, { cause }),
    })

    expect(matrix.coordinates).toHaveLength(plan.coordinates.length)
  }),
)
