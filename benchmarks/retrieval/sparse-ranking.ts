import type { RankedChunk } from "../../src/domain/ports.js"
import type { SparseVector } from "./sparse-encoder.js"

/** In-memory inverted sparse index used to score every query against cached documents. */
export interface SparseIndex {
  readonly postings: ReadonlyMap<number, readonly SparsePosting[]>
}

/** One document contribution for a token in a sparse posting list. */
export interface SparsePosting {
  readonly chunkIndex: number
  readonly weight: number
}

/** Build token postings once so each query touches only intersecting documents. */
export const buildSparseIndex = (documents: readonly SparseVector[]): SparseIndex => {
  const postings = new Map<number, SparsePosting[]>()
  for (let chunkIndex = 0; chunkIndex < documents.length; chunkIndex++) {
    for (const entry of documents[chunkIndex]!) {
      const tokenPostings = postings.get(entry.tokenId) ?? []
      tokenPostings.push({ chunkIndex, weight: entry.weight })
      postings.set(entry.tokenId, tokenPostings)
    }
  }
  return { postings }
}

/** Rank documents by exact inner product over shared sparse token IDs. */
export const rankSparse = (query: SparseVector, index: SparseIndex): readonly RankedChunk[] => {
  const scores = new Map<number, number>()
  for (const queryEntry of query) {
    for (const posting of index.postings.get(queryEntry.tokenId) ?? []) {
      scores.set(
        posting.chunkIndex,
        (scores.get(posting.chunkIndex) ?? 0) + queryEntry.weight * posting.weight,
      )
    }
  }
  return [...scores]
    .map(([chunkIndex, score]) => ({ chunkIndex, score }))
    .sort((left, right) => right.score - left.score || left.chunkIndex - right.chunkIndex)
}
