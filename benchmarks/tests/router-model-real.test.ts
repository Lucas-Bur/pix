import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"

import { expect, it } from "@effect/vitest"
import { Effect } from "effect"

import { runRealRouterModelComparison } from "../retrieval/evaluation/subsample-evidence.js"

const repositoryId = process.env.PIX_BENCH_CORPUS_SIZE_REPO ?? "t3code"
const model = process.env.PIX_BENCH_MODELS ?? "Xenova/all-MiniLM-L6-v2"

it.effect("runs the real multiplicative vs log-linear router comparison", () =>
  Effect.gen(function* () {
    const comparison = yield* runRealRouterModelComparison(repositoryId, model)

    expect(comparison.results).toHaveLength(8)
    expect(comparison.holdouts).toHaveLength(8)
    expect(comparison.developmentSamples).toBeGreaterThan(0)
    expect(comparison.validationSamples).toBeGreaterThan(0)

    const outputDirectory = path.resolve("benchmarks/results")
    const outputPath = path.join(
      outputDirectory,
      `retrieval-router-model-comparison-${repositoryId}-${model.replaceAll("/", "_")}.json`,
    )
    yield* Effect.tryPromise({
      try: async () => {
        await mkdir(outputDirectory, { recursive: true })
        await writeFile(
          outputPath,
          `${JSON.stringify({ schemaVersion: 1, repositoryId, model, ...comparison }, null, 2)}\n`,
          "utf8",
        )
      },
      catch: (cause) =>
        new Error(`Could not write router model comparison ${outputPath}`, { cause }),
    })

    const multiplicative = comparison.holdouts.find((row) => row.model === "multiplicative")
    const logLinear = comparison.holdouts.find((row) => row.model === "regularized-log-linear")
    expect(multiplicative).toBeDefined()
    expect(logLinear).toBeDefined()
  }),
)
