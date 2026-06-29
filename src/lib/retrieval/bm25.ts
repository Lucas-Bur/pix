import type { Bm25Index, RankedChunk } from "../../domain/ports.js"
import { tokenize } from "./tokenize.js"

const K1 = 1.5
const B = 0.75

const buildTermFreqs = (tokens: string[]): Record<string, number> => {
  // Object.create(null) avoids prototype-chain collision with tokens like "constructor".
  // Plain {}["constructor"] returns Object (function, truthy), breaking dictionary init.
  const tf: Record<string, number> = Object.create(null)
  for (const t of tokens) {
    tf[t] = (tf[t] ?? 0) + 1
  }
  return tf
}

export const buildBm25Index = (
  texts: readonly { readonly index: number; readonly text: string }[],
): Bm25Index => {
  const chunkLengths: number[] = []
  // Object.create(null) — same reason as buildTermFreqs: tokens like "constructor" shadow
  // Object.prototype and would break dictionary init with plain {}.
  const docFreqs: Record<string, number> = Object.create(null)
  const chunkTfs: Record<string, [number, number][]> = Object.create(null)

  for (const { index, text } of texts) {
    const tokens = tokenize(text)
    // Chunk length = count of *unique* tokens, not total tokens. Code
    // chunks have heavy structural repetition (keywords like `function`/
    // `return`, brackets, semicolons), so total-token length penalises
    // long, normal functions with many statements even when their
    // vocabulary coverage is high. Unique-token count reflects coverage
    // and is the right length metric for code retrieval.
    //
    // Deliberate deviation from the Lucene/Elasticsearch convention
    // (which uses total tokens). Rationale: we index source code, where
    // syntactic scaffolding dominates raw token volume.
    chunkLengths[index] = new Set(tokens).size

    const tf = buildTermFreqs(tokens)
    for (const [term, freq] of Object.entries(tf)) {
      docFreqs[term] = (docFreqs[term] ?? 0) + 1
      let entries = chunkTfs[term]
      if (!entries) {
        entries = []
        chunkTfs[term] = entries
      }
      entries.push([index, freq])
    }
  }

  const totalTokens = chunkLengths.reduce((a, b) => a + b, 0)
  const avgChunkLength = texts.length > 0 ? totalTokens / texts.length : 0

  return { avgChunkLength, chunkLengths, docFreqs, chunkTfs }
}

const idf = (docCount: number, df: number): number =>
  Math.log(1 + (docCount - df + 0.5) / (df + 0.5))

const bm25Score = (
  tf: number,
  chunkLen: number,
  avgdl: number,
  docCount: number,
  df: number,
): number => {
  const numerator = tf * (K1 + 1)
  const denominator = tf + K1 * (1 - B + B * (chunkLen / avgdl))
  return idf(docCount, df) * (numerator / denominator)
}

export const rankBm25 = (queryText: string, index: Bm25Index): RankedChunk[] => {
  const queryTokens = tokenize(queryText)
  if (queryTokens.length === 0) return []

  const { avgChunkLength, chunkLengths, docFreqs, chunkTfs } = index
  const docCount = chunkLengths.length
  const scores = new Float64Array(docCount)

  for (const term of queryTokens) {
    const df = docFreqs[term]
    if (df == null) continue
    const entries = chunkTfs[term]
    if (!entries) continue
    for (const [chunkIdx, tf] of entries) {
      scores[chunkIdx] += bm25Score(tf, chunkLengths[chunkIdx], avgChunkLength, docCount, df)
    }
  }

  const results: RankedChunk[] = []
  for (let i = 0; i < docCount; i++) {
    if (scores[i] > 0) {
      results.push({ chunkIndex: i, score: scores[i] })
    }
  }
  results.sort((a, b) => b.score - a.score)
  return results
}
