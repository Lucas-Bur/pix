# 0016: AST-aware and token-aware chunking

## Status

Accepted

## Context

Fixed line windows can split functions and classes, reducing retrieval quality. Embedding tokenizers
can also silently truncate oversized inputs, and Dense and Sparse tokenizers do not necessarily count
the same source text identically. ADR-0014 already chose native N-API tree-sitter and established the
shared extension registry for parser dispatch.

## Decision

- Reuse each extension registry entry's parser for chunking.
- Treat each non-comment top-level named AST node as a semantic unit. Greedily pack adjacent units
  under the effective composite token limit, using the larger count from the active Dense and Sparse
  tokenizers with special tokens included and tokenizer truncation disabled.
- Attach immediately preceding comment nodes to the following AST chunk so doc comments contribute
  to its embedding; comments inside declarations are already part of `node.text`.
- Support TypeScript, JavaScript, TSX, JSX, Python, and Rust.
- Recursively split an oversized AST unit through child AST nodes, then source lines, then safe
  whitespace/punctuation boundaries. An unsplittable leaf is skipped and reported rather than
  aborting the index refresh.
- Fall back to token-aware line chunking when no parser exists, parsing fails, or the syntax tree has
  errors. `overlapLines` applies only to this fallback; AST chunks do not overlap.
- Derive the effective cap from configured `chunkTokens`, the Dense/Sparse operational model limits,
  and the configured batch token budgets. `TokenLimitError` rejects any input or batch that still
  exceeds an adapter limit before inference.
- Persist non-fatal parser and skip events as `IndexDiagnostic` entries in the SQLite metadata and
  expose them through `pix index --json` and `pix status --json`.
- Keep the persisted `Chunk` schema unchanged. Chunk IDs use exact source ranges.

## Rationale

Top-level AST nodes preserve semantic declarations without splitting functions or classes. Greedy
packing avoids the tiny-chunk overhead of one embedding per node, while tokenizer-aware fallback keeps
inputs inside both active model contracts. Best-effort diagnostics make malformed or unchunkable
source visible without losing the rest of the index. Reusing the extension registry keeps parser
selection in one place.

## Consequences

AST-supported source receives semantic boundaries without producing tiny embeddings for each import or
declaration, and no embedding call relies on silent tokenizer truncation. Unsupported or temporarily
malformed source remains indexable where safe; diagnostics identify skipped leaves. Parent-child
retrieval, hierarchical embeddings, and result auto-merging require new persisted metadata and remain
separate follow-up slices of issue #83.
