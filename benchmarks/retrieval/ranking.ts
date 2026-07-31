import type { RankedChunk } from "../../src/domain/ports.js"
import { rankBm25 } from "../../src/lib/retrieval/bm25.js"
import { rankCamelCase } from "../../src/lib/retrieval/camelcase.js"
import { rankIdentity } from "../../src/lib/retrieval/identity.js"
import { routeQuery, type RetrievalWeights } from "../../src/lib/retrieval/routing.js"
import { rrfFuse } from "../../src/lib/retrieval/rrf.js"
import type { PreparedCorpus } from "./prepare.js"
import type { RetrievalVariant } from "./types.js"

/** Physical retrieval channel participating in RRF. */
export type ChannelName = keyof RetrievalWeights

/** Rankings produced once per query by each physical retrieval channel. */
export type ChannelRankings = Readonly<Record<ChannelName, readonly RankedChunk[]>>

/** Rankings produced by the lexical channels before dense search is delegated to SQLite. */
export type LexicalChannelRankings = Pick<ChannelRankings, "identity" | "camelcase" | "bm25">

/** All retrieval configurations emitted by the local quality benchmark. */
export const RETRIEVAL_VARIANTS: readonly RetrievalVariant[] = [
  "identity",
  "camelcase",
  "bm25",
  "dense",
  "identifiers",
  "identity+bm25",
  "identity+dense",
  "camelcase+bm25",
  "camelcase+dense",
  "bm25+dense",
  "rrf",
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
    case "rrf-no-identity":
      return ["camelcase", "bm25", "dense"]
    case "rrf-no-camelcase":
      return ["identity", "bm25", "dense"]
    case "rrf-no-bm25":
      return ["identity", "camelcase", "dense"]
    case "rrf-no-dense":
      return ["identity", "camelcase", "bm25"]
    case "rrf":
      return ["identity", "camelcase", "bm25", "dense"]
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

  const weights = routeQuery(query)
  const present = selected.filter((channel) => lists[channel].length > 0)
  return rrfFuse(
    present.map((channel) => lists[channel]),
    present.map((channel) => weights[channel]),
  )
}
