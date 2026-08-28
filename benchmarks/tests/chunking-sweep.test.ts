import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"

import { expect, it } from "@effect/vitest"
import { Effect } from "effect"

import { runChunkingSweep } from "../retrieval/evaluation/subsample-evidence.js"

const repositoryId = process.env.PIX_BENCH_CORPUS_SIZE_REPO ?? "t3code"
const model = process.env.PIX_BENCH_MODELS ?? "Xenova/all-MiniLM-L6-v2"

it.effect("runs the real chunking sweep over multiple token budgets", () =>
  Effect.gen(function* () {
    const rows = yield* runChunkingSweep(repositoryId, model)

    expect(rows.length).toBeGreaterThan(1)
    for (const row of rows) {
      expect(row.chunks).toBeGreaterThan(0)
      expect(Number.isFinite(row.ndcgAt20)).toBe(true)
      expect(row.standardError).toBeGreaterThan(0)
    }

    const outputDirectory = path.resolve("benchmarks/results")
    const outputPath = path.join(
      outputDirectory,
      `retrieval-chunking-${repositoryId}-${model.replaceAll("/", "_")}.json`,
    )
    yield* Effect.tryPromise({
      try: async () => {
        await mkdir(outputDirectory, { recursive: true })
        await writeFile(
          outputPath,
          `${JSON.stringify({ schemaVersion: 1, repositoryId, model, rows }, null, 2)}\n`,
          "utf8",
        )
      },
      catch: (cause) => new Error(`Could not write chunking sweep ${outputPath}`, { cause }),
    })
  }),
)
