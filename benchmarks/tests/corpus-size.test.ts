import { describe, expect, it } from "@effect/vitest"

import { ZERO_CHANNEL_COEFFICIENTS } from "../../src/domain/retrieval.js"
import type { PreparedCorpus } from "../retrieval/corpus/prepare.js"
import {
  buildSubSampleCorpus,
  fitCorpusSizeModel,
  planCorpusSizeSubSamples,
  remapGoldTargets,
  runCorpusSizeSweep,
  type CorpusSizeQuestionGold,
} from "../retrieval/evaluation/corpus-size.js"

const chunk = (file: string, startLine: number) => ({
  file,
  startLine,
  endLine: startLine + 5,
  text: `symbol ${startLine}`,
})

const corpus = (
  chunkCount: number,
  namesByChunk: ReadonlyMap<number, readonly string[]>,
): PreparedCorpus =>
  ({
    chunks: Array.from({ length: chunkCount }, (_, index) => chunk(`src/file${index}.ts`, index)),
    bm25Index: { chunkLengths: [], docFreqs: {}, totalDocs: chunkCount },
    identifierIndex: { exact: {}, split: {} },
    identifiersByChunk: new Map([...namesByChunk].map(([index, names]) => [index, new Set(names)])),
    preparationDurationMs: 0,
  }) as unknown as PreparedCorpus

const questions: readonly CorpusSizeQuestionGold[] = [
  { questionId: "q1", goldChunkIndices: [3] },
  { questionId: "q2", goldChunkIndices: [7, 9] },
  { questionId: "q3", goldChunkIndices: [50] },
]

describe("corpus-size influence", () => {
  it("keeps gold chunks resolvable and records unavoidable drops", () => {
    const plans = planCorpusSizeSubSamples(questions, 100, [3, 200])
    const small = plans[0]!
    const full = plans[1]!

    expect(full.chunkIndices).toHaveLength(100)
    expect(full.droppedQuestions).toEqual([])
    expect(small.chunkIndices).toHaveLength(3)
    for (const question of questions.filter((entry) =>
      small.keptQuestionIds.includes(entry.questionId),
    )) {
      for (const index of question.goldChunkIndices) expect(small.chunkIndices).toContain(index)
    }
    expect(small.droppedQuestions.map((drop) => drop.questionId)).toEqual(["q3"])
    expect(small.keptQuestionIds).toEqual(["q1", "q2"])
  })

  it("rebuilds dense indexes and remaps gold targets into sub-sample space", () => {
    const source = corpus(
      60,
      new Map([
        [50, ["targetSymbol"]],
        [3, ["otherSymbol"]],
      ]),
    )
    const [plan] = planCorpusSizeSubSamples(questions, 60, [10])
    const subSample = buildSubSampleCorpus(source, plan!)

    expect(subSample.chunks).toHaveLength(10)
    expect(subSample.chunkIndexMap.get(50)).toBeDefined()
    expect(subSample.identifiersByChunk.get(subSample.chunkIndexMap.get(50)!)).toEqual(
      new Set(["targetSymbol"]),
    )
    expect(subSample.identifierIndex.exact["targetsymbol"]).toEqual([
      subSample.chunkIndexMap.get(50),
    ])
    expect(subSample.bm25Index.chunkLengths).toHaveLength(10)

    const remapped = remapGoldTargets([new Set([50])], subSample.chunkIndexMap)
    expect([...remapped[0]!]).toEqual([subSample.chunkIndexMap.get(50)])
  })

  it("fits a log-linear relationship and detects shifts outside noise", () => {
    const fit = fitCorpusSizeModel([
      {
        corpusSize: 100,
        weights: { identity: 1, camelcase: 1, bm25: 1, dense: 1, sparse: 1 },
        noise: 0.001,
      },
      {
        corpusSize: 1000,
        weights: { identity: 1, camelcase: 1, bm25: 2, dense: 1, sparse: 1 },
        noise: 0.001,
      },
    ])

    expect(fit.logLinear.find((entry) => entry.channel === "bm25")?.slope).toBeGreaterThan(0)
    expect(fit.sensitivity.shiftedOutsideNoise).toBe(true)
    expect(fit.recommendation).toBe("promote-corpus-size-factor")
  })

  it("recommends no promotion when optima stay inside measurement noise", () => {
    const fit = fitCorpusSizeModel([
      {
        corpusSize: 100,
        weights: { identity: 1, camelcase: 1, bm25: 1, dense: 1, sparse: 1 },
        noise: 0.5,
      },
      {
        corpusSize: 1000,
        weights: { identity: 1, camelcase: 1, bm25: 1.1, dense: 1, sparse: 1 },
        noise: 0.5,
      },
    ])

    expect(fit.sensitivity.shiftedOutsideNoise).toBe(false)
    expect(fit.recommendation).toBe("do-not-promote-corpus-size-factor")
  })

  it("runs the identical sweep protocol per size and derives the fit", async () => {
    const plans = planCorpusSizeSubSamples(questions, 100, [10, 100])
    const { rows, fit } = await runCorpusSizeSweep(
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
            bm25: plan.targetSize >= 100 ? 1.5 : 1,
          },
          score: 0.8,
          noise: 0.01,
        },
      ],
      questions,
    )

    expect(rows).toHaveLength(2)
    expect(new Set(rows.map((row) => row.coordinate.corpusSize))).toEqual(new Set([10, 100]))
    expect(fit.recommendation).toBe("promote-corpus-size-factor")
  })

  it("fails the sweep loudly when a kept question's gold falls outside the sub-sample", async () => {
    const invalidPlan = {
      targetSize: 5,
      chunkIndices: [0, 1, 2],
      keptQuestionIds: ["q1"],
      droppedQuestions: [],
    }
    await expect(runCorpusSizeSweep([invalidPlan], async () => [], questions)).rejects.toThrow(
      "lost gold chunks for q1",
    )
  })

  it("counts duplicate gold indices once against the size budget", () => {
    const [plan] = planCorpusSizeSubSamples(
      [{ questionId: "dup", goldChunkIndices: [3, 3, 7] }],
      100,
      [10],
    )

    expect(plan!.keptQuestionIds).toEqual(["dup"])
    expect(plan!.chunkIndices).toHaveLength(10)
    expect(plan!.chunkIndices.filter((index) => index === 3)).toHaveLength(1)
    expect(plan!.droppedQuestions).toEqual([])
  })
})
