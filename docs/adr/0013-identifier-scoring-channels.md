# 0013: Identifier-based scoring channels

## Status

Accepted

## Context

[ADR-0009](0009-hybrid-search.md) established hybrid retrieval via RRF with two channels: BM25 lexical and dense semantic. This works well for _conceptual_ queries ("retry logic") but underperforms for _named-symbol_ queries in code — a user who knows the identifier `DtypeMismatchError` expects its definition to rank #1, but embeddings match "dtype error mismatch" semantically and the exact name match is buried.

Issue #130 (exact-name identity channel) and #131 (camelCase split channel) closed this gap. This ADR captures the architectural decisions behind how those channels fit into the existing scoring architecture.

## Decision

Extend the RRF fusion from two channels to four by adding two identifier-based scorers, with hardcoded weights exposed as named constants:

| Channel                 | Scorer               | Weight                   | Routing              |
| ----------------------- | -------------------- | ------------------------ | -------------------- |
| Identity (exact name)   | `rankIdentity`       | `WEIGHT_IDENTITY = 3.0`  | constant             |
| CamelCase (split match) | `rankCamelCase`      | `WEIGHT_CAMELCASE = 1.5` | constant             |
| BM25 (lexical)          | `rankBm25`           | `0.5` – `1.5`            | by query token count |
| Dense (semantic)        | SQLite vector search | `0.5` – `1.5`            | by query token count |

`WEIGHT_IDENTITY` and `WEIGHT_CAMELCASE` are constant regardless of query length because they capture _content_ signals (does the query name match an identifier; do the query's constituent words appear in identifier names) rather than _length_ signals. The BM25/Dense rebalance on query length is preserved from ADR-0009.

Both identifier channels consume a pre-built two-map index persisted in `.pix/index.db`:

- `exact: Map<lowercased name, chunkIndex[]>` — full name match
- `split: Map<lowercased constituent word, chunkIndex[]>` — per-word match

The map shape uses plain `Record` (not `Map`) for direct JSON serialization at the storage boundary, consistent with `Bm25Index`.

`chunkIndex` here is **global** — the chunk's persisted SQLite `ordinal` (and equivalently its position in `phase1.chunks` at index time), NOT the per-file `idx` field the chunker assigns. The query-time scorers resolve `chunkIndex` against `entryMap`, which is keyed by the same ordinal. Mixing the two scopes silently biases identity/camelcase matches toward whichever file was indexed first, since two different files' chunks (both at per-file `idx 0`) would otherwise collide on global index 0.

`IdentifierKind` is a language-agnostic three-category vocabulary: `"function" | "type" | "value"`. Each tree-sitter grammar's specific node types (e.g. `function_declaration`, `class_declaration`, `variable_declarator`) are mapped onto this vocabulary at extraction time via a per-language `mapKind` table.

The retrieval channel layout is defined in `src/domain/retrieval.ts`; query routing consumes the
validated production configuration from that module.

## Rationale

**Why RRF channels, not a post-rank rerank** (e.g. the cross-encoder in #101): RRF is a trivial composition. Adding a new channel is one new pure function wired into `fuseResults`. A post-rank rerank adds a model dependency, ~10–50× query latency, and a separate training/evaluation story. We can add a cross-encoder later as another channel without disturbing the existing five-channel seam.

**Why production configuration, not user config**: Weights are a tuning surface, not a user-facing
setting. Benchmark-owned candidates are validated before the promoted configuration is written into
the domain module; runtime callers do not need to understand the search procedure.

**Why identifier signals remain explicit**: Exact-name and CamelCase matches are content signals, while
BM25, Dense, and Sparse are broader lexical-semantic channels. The evidence router keeps those signals
visible and independently adjustable.

**Why two maps, not one with match logic at query time**: Storing the split map pre-computed makes the camelCase scorer a `Record` lookup per constituent word (O(1) per word). A single-map design with a list of "constituent words" per name would force the scorer to walk the full index for every query, which doesn't scale.

**Why language-agnostic `IdentifierKind` with 3 categories**: Code across languages shares three conceptual categories: callable (function/def/fn/method), type (class/struct/enum/interface/trait), data binding (const/let/var/static). Mapping tree-sitter's per-grammar node types (`function_declaration` vs `function_item` vs `function_definition`) onto this vocabulary at extraction time keeps the storage shape and scorers language-agnostic. The MVP scorers do not differentiate by `kind`; it is captured for future use cases (e.g. "find where this is imported", #85) without re-indexing.

**Why separate persisted payloads**: The BM25 index is built from chunk text via `buildBm25Index`. The identifier index is built from parsed ASTs. Their schemas remain independent even though SQLite commits both payloads atomically.

**Why per-chunk re-parsing, not parse-once-and-distribute**: The chunker uses `overlapLines` so adjacent chunks share content. Naively parsing the whole file once and distributing identifiers to chunks by line number is more efficient but couples the extractor to chunker line geometry. For MVP, re-parsing per chunk is simpler, correctly handles overlap (the same identifier legitimately appears in multiple chunks), and the redundant work is bounded by `overlapLines × chunk count` — negligible for typical codebases.

## Consequences

- Five-channel fusion produces more competitive rankings; weights are now a first-class tuning surface in the production fusion configuration.
- Tree-sitter becomes a runtime dependency (deferred decision documented in [ADR-0014](0014-tree-sitter-identifier-extraction.md)).
- Identifier storage is small (a few KB per 1000 chunks) and grows linearly with identifier count, not chunk count.
- Flat-file indexes are rebuilt into SQLite once to obtain the current five-channel data.
- The `IdentifierKind` field is captured but not consumed by the MVP scorers. Future use cases (e.g. #85 call-graph queries) can filter on it without re-indexing.
- The five-channel architecture can accommodate additional channels (cross-encoder rerank from #101, future heuristics) through the same fusion seam.
