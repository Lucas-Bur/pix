import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"

import { expect, it } from "@effect/vitest"
import { Effect, Schema } from "effect"

import type { ChunkingOptions } from "../../src/domain/ports.js"
import { ZERO_CHANNEL_COEFFICIENTS } from "../../src/domain/retrieval.js"
import { prepareCorpus } from "../retrieval/corpus/prepare.js"
import { prepareRepository } from "../retrieval/corpus/repository.js"
import { loadCorpusManifests } from "../retrieval/corpus/repository.js"
import {
  CORPUS_SIZE_STEPS,
  buildSubSampleCorpus,
  planCorpusSizeSubSamples,
  remapGoldTargets,
  runCorpusSizeSweep,
  type CorpusSizeQuestionGold,
} from "../retrieval/evaluation/corpus-size.js"
import { resolveGoldTargets } from "../retrieval/evaluation/metrics.js"

const validationChunkingOptions: ChunkingOptions = {
  maxTokens: Number.MAX_SAFE_INTEGER,
  overlapLines: 0,
  countTokens: () => Effect.succeed(0),
  onDiagnostic: () => Effect.void,
}

it.effect("plans, validates, and sweeps corpus-size sub-samples on a pinned corpus", () =>
  Effect.gen(function* () {
    const manifests = yield* loadCorpusManifests()
    const manifest = manifests.find((entry) => entry.id === "fd")
    if (manifest === undefined) throw new Error("fd corpus manifest is missing")
    const repositoryPath = yield* prepareRepository(manifest)
    const corpus = yield* prepareCorpus(repositoryPath, manifest, validationChunkingOptions)

    const questions: CorpusSizeQuestionGold[] = manifest.questions.map((question) => ({
      questionId: question.id,
      goldChunkIndices: [
        ...new Set(
          resolveGoldTargets(
            question.groundTruth,
            corpus.chunks,
            corpus.identifiersByChunk,
          ).flatMap((targets) => [...targets]),
        ),
      ],
    }))
    expect(questions.every((question) => question.goldChunkIndices.length > 0)).toBe(true)

    const plans = planCorpusSizeSubSamples(questions, corpus.chunks.length, CORPUS_SIZE_STEPS)
    for (const plan of plans) {
      const subSample = buildSubSampleCorpus(corpus, plan)
      const keptQuestions = questions.filter((question) =>
        plan.keptQuestionIds.includes(question.questionId),
      )
      const resolved = remapGoldTargets(
        keptQuestions.flatMap((question) =>
          resolveGoldTargets(
            manifest.questions.find((entry) => entry.id === question.questionId)!.groundTruth,
            corpus.chunks,
            corpus.identifiersByChunk,
          ),
        ),
        subSample.chunkIndexMap,
      )
      expect(resolved.every((targets) => targets.size > 0)).toBe(true)
      expect(subSample.chunks.length).toBe(
        Math.min(plan.targetSize, corpus.chunks.length) || corpus.chunks.length,
      )
    }

    const { rows, fit } = yield* Effect.promise(() =>
      runCorpusSizeSweep(
        plans,
        async (plan) => [
          {
            coordinate: {
              corpusSize: plan.targetSize,
              fusion: "dbsf",
              profile: "search-priority",
              objective: "direct",
              strategy: "grouped-3-fold",
              fold: "1",
            },
            weights: {
              ...ZERO_CHANNEL_COEFFICIENTS,
              bm25: 1 + Math.log10(plan.targetSize) / 10,
            },
            score: 0.8,
            noise: 0.01,
          },
        ],
        questions,
      ),
    )

    const outputDirectory = path.resolve("benchmarks/results")
    const outputPath = path.join(outputDirectory, "retrieval-corpus-size-sweep.json")
    yield* Effect.tryPromise({
      try: async () => {
        await mkdir(outputDirectory, { recursive: true })
        await writeFile(
          outputPath,
          `${JSON.stringify({ schemaVersion: 1, rows, fit }, null, 2)}\n`,
          "utf8",
        )
      },
      catch: (cause) => new Error(`Could not write corpus-size sweep ${outputPath}`, { cause }),
    })

    expect(rows.length).toBe(plans.length)
    expect(
      Schema.is(
        Schema.Struct({
          recommendation: Schema.Literals([
            "promote-corpus-size-factor",
            "do-not-promote-corpus-size-factor",
          ]),
        }),
      )({ recommendation: fit.recommendation }),
    ).toBe(true)
  }),
)
