import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"

import { expect, it } from "@effect/vitest"
import { Effect } from "effect"

import { runRealCorpusSizeSweep } from "../retrieval/evaluation/subsample-evidence.js"

const repositoryId = process.env.PIX_BENCH_CORPUS_SIZE_REPO ?? "t3code"
const model = process.env.PIX_BENCH_MODELS ?? "Xenova/all-MiniLM-L6-v2"

it.effect("runs the real model-backed corpus-size sweep", () =>
  Effect.gen(function* () {
    const result = yield* runRealCorpusSizeSweep(repositoryId, model)

    expect(result.rows).toHaveLength(
      result.fit.logLinear.length > 0 ? result.perSizeSamples.length : 0,
    )
    expect(result.perSizeSamples.length).toBeGreaterThan(1)
    for (const row of result.rows) {
      expect(Number.isFinite(row.coordinate.corpusSize)).toBe(true)
      expect(Object.values(row.weights).every((weight) => Number.isFinite(weight))).toBe(true)
      expect(row.noise).toBeGreaterThan(0)
    }

    const outputDirectory = path.resolve("benchmarks/results")
    const outputPath = path.join(
      outputDirectory,
      `retrieval-corpus-size-model-${repositoryId}-${model.replaceAll("/", "_")}.json`,
    )
    yield* Effect.tryPromise({
      try: async () => {
        await mkdir(outputDirectory, { recursive: true })
        await writeFile(
          outputPath,
          `${JSON.stringify({ schemaVersion: 1, repositoryId, model, ...result }, null, 2)}\n`,
          "utf8",
        )
      },
      catch: (cause) =>
        new Error(`Could not write corpus-size model sweep ${outputPath}`, { cause }),
    })
    expect(result.fit.recommendation).toBeDefined()
  }),
)
