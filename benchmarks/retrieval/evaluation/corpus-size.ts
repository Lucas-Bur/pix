import type { Bm25Index } from "../../../src/domain/ports.js"
import {
  CHANNEL_NAMES,
  type ChannelName,
  type ChannelWeights,
} from "../../../src/domain/retrieval.js"
import { buildBm25Index } from "../../../src/lib/retrieval/bm25.js"
import { buildIdentifierIndex } from "../../../src/lib/retrieval/identifier-index.js"
import type { PreparedCorpus } from "../corpus/prepare.js"
import type { ChunkIdentifiers } from "./metrics.js"

/** Default corpus-size sweep; `Infinity` means the full corpus. */
export const CORPUS_SIZE_STEPS: readonly number[] = [
  200,
  500,
  1000,
  2500,
  5000,
  Number.POSITIVE_INFINITY,
]

/** Per-question gold chunk indices in the original corpus index space. */
export interface CorpusSizeQuestionGold {
  readonly questionId: string
  readonly goldChunkIndices: readonly number[]
}

/** One recorded question drop from a sub-sample. */
export interface CorpusSizeDroppedQuestion {
  readonly questionId: string
  readonly reason: "gold-exceeds-size-budget"
}

/** Deterministic sub-sample plan for one corpus size. */
export interface CorpusSizeSubSample {
  readonly targetSize: number
  readonly chunkIndices: readonly number[]
  readonly keptQuestionIds: readonly string[]
  readonly droppedQuestions: readonly CorpusSizeDroppedQuestion[]
}

/**
 * Plan deterministic sub-samples that keep every evaluated question's gold chunks resolvable.
 * Questions whose gold no longer fits a size budget are dropped and recorded. Gold indices are
 * deduplicated per question, and a post-condition throws if a kept question's gold ever falls
 * outside the selected chunks.
 */
export const planCorpusSizeSubSamples = (
  questions: readonly CorpusSizeQuestionGold[],
  chunkCount: number,
  sizes: readonly number[] = CORPUS_SIZE_STEPS,
): readonly CorpusSizeSubSample[] => {
  const deduped = questions.map((question) => ({
    ...question,
    goldChunkIndices: [...new Set(question.goldChunkIndices)],
  }))
  return [...sizes]
    .sort((left, right) => left - right)
    .map((targetSize) => {
      if (!Number.isFinite(targetSize) || targetSize >= chunkCount)
        return {
          targetSize,
          chunkIndices: Array.from({ length: chunkCount }, (_, index) => index),
          keptQuestionIds: deduped.map((question) => question.questionId),
          droppedQuestions: [],
        }

      const keptQuestionIds: string[] = []
      const droppedQuestions: CorpusSizeDroppedQuestion[] = []
      const mustKeep = new Set<number>()
      for (const question of deduped) {
        const missing = question.goldChunkIndices.filter((index) => !mustKeep.has(index))
        if (mustKeep.size + missing.length <= targetSize) {
          keptQuestionIds.push(question.questionId)
          for (const index of missing) mustKeep.add(index)
        } else {
          droppedQuestions.push({
            questionId: question.questionId,
            reason: "gold-exceeds-size-budget",
          })
        }
      }

      const candidates = Array.from({ length: chunkCount }, (_, index) => index).filter(
        (index) => !mustKeep.has(index),
      )
      const remaining = targetSize - mustKeep.size
      const picked = new Set<number>()
      for (let slot = 0; slot < remaining; slot++)
        picked.add(candidates[Math.floor((slot * candidates.length) / remaining)]!)
      const chunkIndices = [...mustKeep, ...picked].sort((left, right) => left - right)
      const plan = { targetSize, chunkIndices, keptQuestionIds, droppedQuestions }
      validateSubSampleGoldCoverage(deduped, plan)
      return plan
    })
}

/** Fail fast when a kept question's gold chunks are not fully contained in the sub-sample. */
export const validateSubSampleGoldCoverage = (
  questions: readonly CorpusSizeQuestionGold[],
  plan: CorpusSizeSubSample,
): void => {
  const selected = new Set(plan.chunkIndices)
  const kept = new Set(plan.keptQuestionIds)
  for (const question of questions) {
    if (!kept.has(question.questionId)) continue
    const missing = question.goldChunkIndices.filter((index) => !selected.has(index))
    if (missing.length > 0)
      throw new Error(
        `Corpus-size sub-sample ${plan.targetSize} lost gold chunks for ${question.questionId}: ${missing.join(", ")}`,
      )
  }
}

/** Rebuilt indexes and remapped gold targets for one sub-sample. */
export interface SubSampleCorpus {
  readonly chunks: readonly PreparedCorpus["chunks"][number][]
  readonly bm25Index: Bm25Index
  readonly identifiersByChunk: ChunkIdentifiers
  readonly identifierIndex: ReturnType<typeof buildIdentifierIndex>
  readonly chunkIndexMap: ReadonlyMap<number, number>
}

/** Build runnable indexes for a sub-sample, remapping every chunk index into dense 0..N-1 space. */
export const buildSubSampleCorpus = (
  corpus: PreparedCorpus,
  plan: CorpusSizeSubSample,
): SubSampleCorpus => {
  const chunkIndexMap = new Map<number, number>(
    plan.chunkIndices.map((originalIndex, newIndex) => [originalIndex, newIndex]),
  )
  const chunks = plan.chunkIndices.map((originalIndex) => corpus.chunks[originalIndex]!)
  const identifiersByChunk: Map<number, ReadonlySet<string>> = new Map()
  const identifiers: { name: string; chunkIndex: number }[] = []
  for (const [originalIndex, newIndex] of chunkIndexMap) {
    const names = corpus.identifiersByChunk.get(originalIndex)
    if (names === undefined) continue
    identifiersByChunk.set(newIndex, names)
    for (const name of names) identifiers.push({ name, chunkIndex: newIndex })
  }
  return {
    chunks,
    bm25Index: buildBm25Index(chunks.map((chunk, index) => ({ index, text: chunk.text }))),
    identifiersByChunk,
    identifierIndex: buildIdentifierIndex(
      identifiers.map((identifier) => ({ ...identifier, kind: "value" as const })),
    ),
    chunkIndexMap,
  }
}

/** Remap gold chunk-index sets from the original index space into a sub-sample's dense space. */
export const remapGoldTargets = (
  targets: readonly ReadonlySet<number>[],
  chunkIndexMap: ReadonlyMap<number, number>,
): readonly ReadonlySet<number>[] =>
  targets.map((target) => {
    const remapped = new Set<number>()
    for (const index of target) {
      const mapped = chunkIndexMap.get(index)
      if (mapped !== undefined) remapped.add(mapped)
    }
    return remapped
  })

/** Optimal router weights measured at one corpus size. */
export interface CorpusSizeOptimum {
  readonly corpusSize: number
  readonly weights: ChannelWeights
  /** One-standard-error noise band of the selected optimum. */
  readonly noise: number
}

/** Fitted corpus-size relationship across channels. */
export interface CorpusSizeFit {
  readonly logLinear: readonly { channel: ChannelName; slope: number; intercept: number }[]
  readonly largestRelativeShift: {
    corpusSize: number
    channel: ChannelName
    relativeShift: number
  } | null
  readonly sensitivity: {
    readonly shiftedOutsideNoise: boolean
    readonly pairs: readonly {
      readonly fromSize: number
      readonly toSize: number
      readonly channel: ChannelName
      readonly delta: number
      readonly noise: number
    }[]
  }
  readonly recommendation: "promote-corpus-size-factor" | "do-not-promote-corpus-size-factor"
}

const leastSquares = (
  points: readonly (readonly [number, number])[],
): { slope: number; intercept: number } => {
  const n = points.length
  if (n === 0) return { slope: 0, intercept: 0 }
  const meanX = points.reduce((sum, [x]) => sum + x, 0) / n
  const meanY = points.reduce((sum, [, y]) => sum + y, 0) / n
  let covariance = 0
  let variance = 0
  for (const [x, y] of points) {
    covariance += (x - meanX) * (y - meanY)
    variance += (x - meanX) ** 2
  }
  const slope = variance === 0 ? 0 : covariance / variance
  return { slope, intercept: meanY - slope * meanX }
}

/**
 * Fit the corpus-size relationship from the per-size optimum series: a log-linear curve over
 * log(chunkCount) per channel plus a sensitivity check against measurement noise.
 */
export const fitCorpusSizeModel = (optima: readonly CorpusSizeOptimum[]): CorpusSizeFit => {
  const finite = optima.filter((optimum) => Number.isFinite(optimum.corpusSize))
  const logLinear = CHANNEL_NAMES.map((channel) => {
    const { slope, intercept } = leastSquares(
      finite.map((optimum) => [Math.log(optimum.corpusSize), optimum.weights[channel]] as const),
    )
    return { channel, slope, intercept }
  })

  const pairs: {
    fromSize: number
    toSize: number
    channel: ChannelName
    delta: number
    noise: number
  }[] = []
  let largest: CorpusSizeFit["largestRelativeShift"] = null
  for (let index = 1; index < optima.length; index++) {
    const from = optima[index - 1]!
    const to = optima[index]!
    for (const channel of CHANNEL_NAMES) {
      const delta = Math.abs(to.weights[channel] - from.weights[channel])
      const noise = Math.hypot(from.noise, to.noise)
      pairs.push({ fromSize: from.corpusSize, toSize: to.corpusSize, channel, delta, noise })
      const base = Math.max(from.weights[channel], to.weights[channel], 0.1)
      const relativeShift = delta / base
      if (largest === null || relativeShift > largest.relativeShift)
        largest = { corpusSize: to.corpusSize, channel, relativeShift }
    }
  }
  const shiftedOutsideNoise = pairs.some((pair) => pair.delta > pair.noise)
  return {
    logLinear,
    largestRelativeShift: largest,
    sensitivity: { shiftedOutsideNoise, pairs },
    recommendation: shiftedOutsideNoise
      ? "promote-corpus-size-factor"
      : "do-not-promote-corpus-size-factor",
  }
}

/** Exact identity of one per-size sweep result. */
export interface CorpusSizeSweepCoordinate {
  readonly corpusSize: number
  readonly fusion: string
  readonly profile: string
  readonly objective: string
  readonly strategy: string
  readonly fold: string
}

/** One per-size sweep result with its optimal weights and score noise. */
export interface CorpusSizeSweepRow {
  readonly coordinate: CorpusSizeSweepCoordinate
  readonly weights: ChannelWeights
  readonly score: number
  readonly noise: number
}

/** Search protocol executed identically for every corpus size. */
export type CorpusSizeSearch = (plan: CorpusSizeSubSample) => Promise<readonly CorpusSizeSweepRow[]>

/**
 * Orchestrate the per-size sweep and derive the fitted model from its optima. When the question
 * gold is supplied, every plan is validated to still resolve all kept questions' gold chunks.
 */
export const runCorpusSizeSweep = async (
  plans: readonly CorpusSizeSubSample[],
  searchAtSize: CorpusSizeSearch,
  questions?: readonly CorpusSizeQuestionGold[],
): Promise<{ readonly rows: readonly CorpusSizeSweepRow[]; readonly fit: CorpusSizeFit }> => {
  const rows: CorpusSizeSweepRow[] = []
  for (const plan of plans) {
    if (questions !== undefined) validateSubSampleGoldCoverage(questions, plan)
    rows.push(...(await searchAtSize(plan)))
  }
  const optima = plans.map((plan) => {
    const planRows = rows.filter((row) => row.coordinate.corpusSize === plan.targetSize)
    const best = [...planRows].sort((left, right) => right.score - left.score)[0]
    if (best === undefined)
      throw new Error(`Corpus-size sweep produced no result for size ${plan.targetSize}`)
    return { corpusSize: plan.targetSize, weights: best.weights, noise: best.noise }
  })
  return { rows, fit: fitCorpusSizeModel(optima) }
}
