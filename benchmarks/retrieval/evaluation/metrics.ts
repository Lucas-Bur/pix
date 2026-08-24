import type { Chunk } from "../../../src/domain/chunk.js"
import type { RankedChunk } from "../../../src/domain/ports.js"
import type { GoldLocation } from "../corpus/manifest.js"
import { binaryNdcgAt } from "./metrics-core.mjs"

/** Indexed identifiers retained per chunk so gold symbols can be matched exactly. */
export type ChunkIdentifiers = ReadonlyMap<number, ReadonlySet<string>>

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

const declarationPattern = (symbol: string): RegExp => {
  const name = escapeRegExp(symbol)
  return new RegExp(
    `(?:async\\s+def|def|class|function|interface|type|const|let|var|fn|struct|enum|trait|static)\\s+${name}\\b`,
  )
}

/** Resolve each file-qualified gold symbol to all chunks containing that exact identifier. */
export const resolveGoldTargets = (
  gold: readonly GoldLocation[],
  chunks: readonly Chunk[],
  identifiers: ChunkIdentifiers,
): readonly ReadonlySet<number>[] =>
  gold.map((target) => {
    const indexes = new Set<number>()
    const declaration = declarationPattern(target.symbol)
    const lowerSymbol = target.symbol.toLowerCase()
    for (let index = 0; index < chunks.length; index++) {
      const chunk = chunks[index]
      if (chunk.file !== target.file) continue
      if (identifiers.get(index)?.has(lowerSymbol) || declaration.test(chunk.text)) {
        indexes.add(index)
      }
    }
    return indexes
  })

/** Fraction of authored gold targets represented by at least one result in the first K ranks. */
export const recallAt = (
  ranked: readonly RankedChunk[],
  targets: readonly ReadonlySet<number>[],
  k: number,
): number => {
  if (targets.length === 0) return 1
  const returned = new Set(ranked.slice(0, k).map((entry) => entry.chunkIndex))
  const found = targets.filter((target) => [...target].some((index) => returned.has(index))).length
  return found / targets.length
}

/** Whether every authored gold target is represented in the first K ranks. */
export const successAt = (
  ranked: readonly RankedChunk[],
  targets: readonly ReadonlySet<number>[],
  k: number,
): boolean => recallAt(ranked, targets, k) === 1

/** Reciprocal rank of the first result matching any authored gold target. */
export const reciprocalRank = (
  ranked: readonly RankedChunk[],
  targets: readonly ReadonlySet<number>[],
): number => {
  const relevant = new Set(targets.flatMap((target) => [...target]))
  const rank = ranked.findIndex((entry) => relevant.has(entry.chunkIndex))
  return rank < 0 ? 0 : 1 / (rank + 1)
}

/** Binary NDCG at K over unique chunks that resolve at least one exact gold target. */
export const normalizedDiscountedCumulativeGain = (
  ranked: readonly RankedChunk[],
  targets: readonly ReadonlySet<number>[],
  k: number,
): number => {
  return binaryNdcgAt(
    ranked.map((entry) => entry.chunkIndex),
    targets.map((target) => [...target]),
    k,
  )
}

/** One-based best rank for every authored target, or null when the channel did not retrieve it. */
export const goldTargetRanks = (
  ranked: readonly RankedChunk[],
  targets: readonly ReadonlySet<number>[],
): readonly (number | null)[] =>
  targets.map((target) => {
    const rank = ranked.findIndex((entry) => target.has(entry.chunkIndex))
    return rank < 0 ? null : rank + 1
  })

/** Deterministic context-token estimate used when no agent-model tokenizer is involved. */
const estimateContextTokens = (chunk: Chunk): number => {
  const rendered = `${chunk.file}:${chunk.startLine}-${chunk.endLine}\n${chunk.text}`
  return Math.ceil(Buffer.byteLength(rendered, "utf8") / 4)
}

/** Gold recall after packing complete ranked chunks into a fixed estimated-token budget. */
export const contextRecallAtBudget = (
  ranked: readonly RankedChunk[],
  targets: readonly ReadonlySet<number>[],
  chunks: readonly Chunk[],
  budget: number,
): number => {
  let consumed = 0
  let rankedPrefix = 0
  for (const entry of ranked) {
    const chunk = chunks[entry.chunkIndex]
    if (chunk === undefined) {
      rankedPrefix++
      continue
    }
    const tokens = estimateContextTokens(chunk)
    if (consumed + tokens > budget) break
    consumed += tokens
    rankedPrefix++
  }
  return recallAt(ranked, targets, rankedPrefix)
}
