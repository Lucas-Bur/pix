import type { RankedChunk } from "../../src/domain/ports.js"
import {
  CHANNEL_NAMES as DOMAIN_CHANNEL_NAMES,
  type ChannelName,
  type ChannelRankings,
  type ChannelWeights,
} from "../../src/domain/retrieval.js"
import { rankBm25 } from "../../src/lib/retrieval/bm25.js"
import { rankCamelCase } from "../../src/lib/retrieval/camelcase.js"
import { fuseRankings } from "../../src/lib/retrieval/fusion.js"
import { rankIdentity } from "../../src/lib/retrieval/identity.js"
import { routeQuery } from "../../src/lib/retrieval/routing.js"
import type { PreparedCorpus } from "./prepare.js"
import type { RetrievalVariant } from "./types.js"

export const CHANNEL_NAMES = DOMAIN_CHANNEL_NAMES
export type { ChannelName, ChannelRankings }

/** Rankings produced by the lexical channels before dense search is delegated to SQLite. */
export type LexicalChannelRankings = Pick<ChannelRankings, "identity" | "camelcase" | "bm25">

/** All retrieval configurations emitted by the local quality benchmark. */
export const RETRIEVAL_VARIANTS: readonly RetrievalVariant[] = [
  "identity",
  "camelcase",
  "bm25",
  "dense",
  "sparse",
  "identifiers",
  "identity+bm25",
  "identity+dense",
  "camelcase+bm25",
  "camelcase+dense",
  "bm25+dense",
  "identifiers+sparse",
  "bm25+sparse",
  "dense+sparse",
  "rrf-equal",
  "rrf",
  "rrf-no-sparse",
  "rrf-no-identity",
  "rrf-no-camelcase",
  "rrf-no-bm25",
  "rrf-no-dense",
]

const channelsForVariant = (variant: RetrievalVariant): readonly ChannelName[] => {
  switch (variant) {
    case "identity":
    case "camelcase":
    case "bm25":
    case "dense":
    case "sparse":
      return [variant]
    case "identifiers":
      return ["identity", "camelcase"]
    case "identity+bm25":
      return ["identity", "bm25"]
    case "identity+dense":
      return ["identity", "dense"]
    case "camelcase+bm25":
      return ["camelcase", "bm25"]
    case "camelcase+dense":
      return ["camelcase", "dense"]
    case "bm25+dense":
      return ["bm25", "dense"]
    case "identifiers+sparse":
      return ["identity", "camelcase", "sparse"]
    case "bm25+sparse":
      return ["bm25", "sparse"]
    case "dense+sparse":
      return ["dense", "sparse"]
    case "rrf-no-sparse": // Equal-weight five-channel control with Sparse removed.
      return ["identity", "camelcase", "bm25", "dense"]
    case "rrf-no-identity":
      return ["camelcase", "bm25", "dense"]
    case "rrf-no-camelcase":
      return ["identity", "bm25", "dense"]
    case "rrf-no-bm25":
      return ["identity", "camelcase", "dense"]
    case "rrf-no-dense":
      return ["identity", "camelcase", "bm25"]
    case "rrf-equal":
    case "rrf":
      return [...CHANNEL_NAMES]
  }
}

/** Execute the lexical retrieval channels once for a query. */
export const rankLexicalChannels = (
  query: string,
  corpus: Pick<PreparedCorpus, "bm25Index" | "identifierIndex">,
): LexicalChannelRankings => ({
  identity: rankIdentity(query, corpus.identifierIndex),
  camelcase: rankCamelCase(query, corpus.identifierIndex),
  bm25: rankBm25(query, corpus.bm25Index),
})

/** Fuse precomputed channel rankings with production query-routing weights. */
export const fuseVariant = (
  variant: RetrievalVariant,
  query: string,
  lists: ChannelRankings,
): readonly RankedChunk[] => {
  const selected = channelsForVariant(variant)
  if (selected.length === 1) return lists[selected[0]]

  const weights: ChannelWeights =
    variant === "rrf"
      ? routeQuery(query)
      : { identity: 1, camelcase: 1, bm25: 1, dense: 1, sparse: 1 }
  const selectedRankings: ChannelRankings = {
    identity: selected.includes("identity") ? lists.identity : [],
    camelcase: selected.includes("camelcase") ? lists.camelcase : [],
    bm25: selected.includes("bm25") ? lists.bm25 : [],
    dense: selected.includes("dense") ? lists.dense : [],
    sparse: selected.includes("sparse") ? lists.sparse : [],
  }
  return fuseRankings("rrf", selectedRankings, weights)
}
