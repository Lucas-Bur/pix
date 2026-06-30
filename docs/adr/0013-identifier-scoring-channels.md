# 0013: Identifier-based scoring channels

## Status

Accepted

## Context

[ADR-0009](0009-hybrid-search.md) established hybrid retrieval via RRF with two channels: BM25 lexical and dense semantic. This works well for _conceptual_ queries ("retry logic") but underperforms for _named-symbol_ queries in code — a user who knows the identifier `DtypeMismatchError` expects its definition to rank #1, but embeddings match "dtype error mismatch" semantically and the exact name match is buried.

Issue #130 (exact-name identity channel) and #131 (camelCase split channel) closed this gap. This ADR captures the architectural decisions behind how those channels fit into the existing scoring architecture.

## Decision

Extend the RRF fusion from two channels to four by adding two identifier-based scorers, with hardcoded weights exposed as named constants:

| Channel                 | Scorer          | Weight                   | Routing              |
| ----------------------- | --------------- | ------------------------ | -------------------- |
| Identity (exact name)   | `rankIdentity`  | `WEIGHT_IDENTITY = 3.0`  | constant             |
| CamelCase (split match) | `rankCamelCase` | `WEIGHT_CAMELCASE = 1.5` | constant             |
| BM25 (lexical)          | `rankBm25`      | `0.5` – `1.5`            | by query token count |
| Dense (semantic)        | `rankDense`     | `0.5` – `1.5`            | by query token count |

`WEIGHT_IDENTITY` and `WEIGHT_CAMELCASE` are constant regardless of query length because they capture _content_ signals (does the query name match an identifier; do the query's constituent words appear in identifier names) rather than _length_ signals. The BM25/Dense rebalance on query length is preserved from ADR-0009.

Both identifier channels consume a pre-built two-map index persisted in `.pix/identifiers.json`:

- `exact: Map<lowercased name, chunkIndex[]>` — full name match
- `split: Map<lowercased constituent word, chunkIndex[]>` — per-word match

The map shape uses plain `Record` (not `Map`) for direct JSON serialization at the storage boundary, consistent with `Bm25Index`.

`IdentifierKind` is a language-agnostic three-category vocabulary: `"function" | "type" | "value"`. Each tree-sitter grammar's specific node types (e.g. `function_declaration`, `class_declaration`, `variable_declarator`) are mapped onto this vocabulary at extraction time via a per-language `mapKind` table.

The RRF channel layout, query routing, and channel weight definitions live at the top of `src/application/query-project.ts` for visibility and easy hand-tuning.

## Rationale

**Why RRF channels, not a post-rank rerank** (e.g. the cross-encoder in #101): RRF is a trivial composition. Adding a new channel is one new pure function wired into `fuseResults`. A post-rank rerank adds a model dependency, ~10–50× query latency, and a separate training/evaluation story. We can add a cross-encoder later as a _fifth_ channel without disturbing the existing four.

**Why hardcoded weights, not config**: Weights are a tuning surface, not a user-facing setting. The BM25/Dense weights already work heuristically; the new weights (3.0 / 1.5) are chosen to give exact-name match ~3× the influence of conceptual match. If empirical evaluation later shows a different balance, changing the constants is a one-line diff. Premature configurability would force every reader to consider the weight axis without data to anchor on.

**Why identity weight > camelcase weight > others**: Exact-name match is the strongest signal available — if the query string is an identifier name, the user knows what they're looking for. CamelCase split is a softer signal — it could match a coincidental constituent word. The 3.0 / 1.5 / 1.0 / 1.0 ordering matches this confidence gradient.

**Why two maps, not one with match logic at query time**: Storing the split map pre-computed makes the camelCase scorer a `Record` lookup per constituent word (O(1) per word). A single-map design with a list of "constituent words" per name would force the scorer to walk the full index for every query, which doesn't scale.

**Why language-agnostic `IdentifierKind` with 3 categories**: Code across languages shares three conceptual categories: callable (function/def/fn/method), type (class/struct/enum/interface/trait), data binding (const/let/var/static). Mapping tree-sitter's per-grammar node types (`function_declaration` vs `function_item` vs `function_definition`) onto this vocabulary at extraction time keeps the storage shape and scorers language-agnostic. The MVP scorers do not differentiate by `kind`; it is captured for future use cases (e.g. "find where this is imported", #85) without re-indexing.

**Why a separate `.pix/identifiers.json` file, not merged into `bm25.json`**: The BM25 index is built from chunk text via `buildBm25Index`. The identifier index is built from parsed ASTs. Their build and read paths are independent. Separate files keep commit windows atomic per concern and give a clean migration path (old indexes without the new file just see empty maps).

**Why per-chunk re-parsing, not parse-once-and-distribute**: The chunker uses `overlapLines` so adjacent chunks share content. Naively parsing the whole file once and distributing identifiers to chunks by line number is more efficient but couples the extractor to chunker line geometry. For MVP, re-parsing per chunk is simpler, correctly handles overlap (the same identifier legitimately appears in multiple chunks), and the redundant work is bounded by `overlapLines × chunk count` — negligible for typical codebases.

## Consequences

- Four-channel fusion produces more competitive rankings; weights are now a first-class tuning surface (the four `const` at the top of `query-project.ts`).
- Tree-sitter becomes a runtime dependency (deferred decision documented in [ADR-0014](0014-tree-sitter-identifier-extraction.md)).
- Storage grows by one file (`.pix/identifiers.json`); expected size is small (a few KB per 1000 chunks) and grows linearly with identifier count, not chunk count.
- Backward-compatibility: indexes built before this feature shipped have no `.pix/identifiers.json`. `loadIdentifierIndex` returns empty maps; the identity and camelCase scorers return `[]`; the query still works via BM25 + Dense. Users re-index once to get the new channels.
- The `IdentifierKind` field is captured but not consumed by the MVP scorers. Future use cases (e.g. #85 call-graph queries) can filter on it without re-indexing.
- The four-channel architecture can accommodate additional channels (cross-encoder rerank from #101, future heuristics) without changing the fusion logic.
