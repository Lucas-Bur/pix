import { binaryNdcgAt } from "./metrics-core.mjs"

export const evaluatePreparedContributions = (matrix, weights) => {
  const activeMask =
    Number(weights.identity > 0) |
    (Number(weights.camelcase > 0) << 1) |
    (Number(weights.bm25 > 0) << 2) |
    (Number(weights.dense > 0) << 3) |
    (Number(weights.sparse > 0) << 4)
  if (activeMask === 0) return []

  const entries = []
  for (let position = 0; position < matrix.chunkIndices.length; position++) {
    const available = matrix.presence[position] & activeMask
    if (available === 0) continue
    let score = 0
    if ((available & 1) !== 0) score += weights.identity * matrix.values.identity[position]
    if ((available & 2) !== 0) score += weights.camelcase * matrix.values.camelcase[position]
    if ((available & 4) !== 0) score += weights.bm25 * matrix.values.bm25[position]
    if ((available & 8) !== 0) score += weights.dense * matrix.values.dense[position]
    if ((available & 16) !== 0) score += weights.sparse * matrix.values.sparse[position]
    entries.push([matrix.chunkIndices[position], score])
  }
  return entries
    .sort(
      ([leftChunkIndex, leftScore], [rightChunkIndex, rightScore]) =>
        rightScore - leftScore || leftChunkIndex - rightChunkIndex,
    )
    .map(([chunkIndex, score]) => ({ chunkIndex, score }))
}

const weightsForSample = (candidate, sampleIndex) =>
  Array.isArray(candidate.weights) ? candidate.weights[sampleIndex] : candidate.weights

const recallAt = (ranked, targets, k) => {
  if (targets.length === 0) return 1
  const returned = new Set(ranked.slice(0, k))
  const found = targets.filter((target) => target.some((index) => returned.has(index))).length
  return found / targets.length
}

const reciprocalRank = (ranked, targets) => {
  const relevant = new Set(targets.flatMap((target) => target))
  const rank = ranked.findIndex((index) => relevant.has(index))
  return rank < 0 ? 0 : 1 / (rank + 1)
}

const contextRecallAtBudget = (ranked, sample, budget) => {
  let consumed = 0
  let rankedPrefix = 0
  for (const chunkIndex of ranked) {
    const tokens = sample.contextTokens[chunkIndex]
    if (tokens === undefined) {
      rankedPrefix++
      continue
    }
    if (consumed + tokens > budget) break
    consumed += tokens
    rankedPrefix++
  }
  return recallAt(ranked, sample.targets, rankedPrefix)
}

export const evaluateCandidate = (snapshot, candidate) => {
  let recall5 = 0
  let recall10 = 0
  let recall20 = 0
  let recall50 = 0
  let ndcg5 = 0
  let ndcg10 = 0
  let ndcg20 = 0
  let ndcg50 = 0
  let contextRecall = 0
  let meanReciprocalRank = 0
  let totalWeight = 0

  for (let sampleIndex = 0; sampleIndex < snapshot.samples.length; sampleIndex++) {
    const sample = snapshot.samples[sampleIndex]
    const weight = sample.sampleWeight
    if (weight <= 0) continue
    const weights = weightsForSample(candidate, sampleIndex)
    if (weights === undefined) throw new Error(`Missing weights for sample ${sampleIndex}`)
    const ranked = evaluatePreparedContributions(sample.fusion, weights).map(
      (entry) => entry.chunkIndex,
    )
    recall5 += weight * recallAt(ranked, sample.targets, 5)
    recall10 += weight * recallAt(ranked, sample.targets, 10)
    recall20 += weight * recallAt(ranked, sample.targets, 20)
    recall50 += weight * recallAt(ranked, sample.targets, 50)
    ndcg5 += weight * binaryNdcgAt(ranked, sample.targets, 5)
    ndcg10 += weight * binaryNdcgAt(ranked, sample.targets, 10)
    ndcg20 += weight * binaryNdcgAt(ranked, sample.targets, 20)
    ndcg50 += weight * binaryNdcgAt(ranked, sample.targets, 50)
    contextRecall += weight * contextRecallAtBudget(ranked, sample, 4096)
    meanReciprocalRank += weight * reciprocalRank(ranked, sample.targets)
    totalWeight += weight
  }

  if (totalWeight === 0)
    return {
      recallAt5: 0,
      recallAt10: 0,
      recallAt20: 0,
      recallAt50: 0,
      ndcgAt5: 0,
      ndcgAt10: 0,
      ndcgAt20: 0,
      ndcgAt50: 0,
      contextRecallAt4096: 0,
      meanReciprocalRank: 0,
    }

  return {
    recallAt5: recall5 / totalWeight,
    recallAt10: recall10 / totalWeight,
    recallAt20: recall20 / totalWeight,
    recallAt50: recall50 / totalWeight,
    ndcgAt5: ndcg5 / totalWeight,
    ndcgAt10: ndcg10 / totalWeight,
    ndcgAt20: ndcg20 / totalWeight,
    ndcgAt50: ndcg50 / totalWeight,
    contextRecallAt4096: contextRecall / totalWeight,
    meanReciprocalRank: meanReciprocalRank / totalWeight,
  }
}
