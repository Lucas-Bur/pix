import type { SparseVector } from "../../domain/sparse.js"

const validateShapes = (
  logits: Float32Array,
  batchSize: number,
  sequenceLength: number,
  vocabularySize: number,
  attentionMask: readonly number[],
): void => {
  if (logits.length !== batchSize * sequenceLength * vocabularySize) {
    throw new RangeError("Sparse logits do not match their declared dimensions")
  }
  if (attentionMask.length !== batchSize * sequenceLength) {
    throw new RangeError("Sparse attention mask does not match the logits dimensions")
  }
}

const maxPoolBatch = (
  logits: Float32Array,
  batch: number,
  sequenceLength: number,
  vocabularySize: number,
  attentionMask: readonly number[],
): Float32Array => {
  const maxima = new Float32Array(vocabularySize)
  for (let position = 0; position < sequenceLength; position++) {
    if (attentionMask[batch * sequenceLength + position] === 0) continue
    const offset = (batch * sequenceLength + position) * vocabularySize
    for (let tokenId = 0; tokenId < vocabularySize; tokenId++) {
      const value = logits[offset + tokenId]!
      if (value > maxima[tokenId]!) maxima[tokenId] = value
    }
  }
  return maxima
}

const projectTerms = (
  maxima: Float32Array,
  specialTokenIds: ReadonlySet<number>,
): SparseVector["terms"] => {
  const terms = []
  for (let tokenId = 0; tokenId < maxima.length; tokenId++) {
    const maximum = maxima[tokenId]!
    if (maximum <= 0 || specialTokenIds.has(tokenId)) continue
    terms.push({ tokenId, weight: Math.log1p(Math.log1p(maximum)) })
  }
  return terms
}

/** Max-pool positive vocabulary logits into the OpenSearch Distill sparse document contract. */
export const poolSparseLogits = (
  logits: Float32Array,
  dimensions: readonly [number, number, number],
  attentionMask: readonly number[],
  specialTokenIds: ReadonlySet<number>,
): readonly SparseVector[] => {
  const [batchSize, sequenceLength, vocabularySize] = dimensions
  validateShapes(logits, batchSize, sequenceLength, vocabularySize, attentionMask)
  return Array.from({ length: batchSize }, (_, batch) => ({
    terms: projectTerms(
      maxPoolBatch(logits, batch, sequenceLength, vocabularySize, attentionMask),
      specialTokenIds,
    ),
  }))
}

/** Remove duplicate and special token IDs before SQLite applies the persisted static IDF table. */
export const buildSparseQueryTokenIds = (
  tokenIds: readonly number[],
  specialTokenIds: ReadonlySet<number>,
): readonly number[] => {
  const unique = new Set<number>()
  for (const tokenId of tokenIds) {
    if (specialTokenIds.has(tokenId)) continue
    unique.add(tokenId)
  }
  return [...unique].sort((left, right) => left - right)
}
