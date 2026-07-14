# 0016: AST-aware chunking with line fallback

## Status

Accepted

## Context

Fixed line windows can split functions and classes, reducing retrieval quality. ADR-0014 already chose
native N-API tree-sitter and established the shared extension registry for parser dispatch.

## Decision

- Reuse each extension registry entry's parser for chunking.
- Treat each non-comment top-level named AST node as an indivisible semantic unit. Greedily pack adjacent units into chunks spanning at most `chunkLines`; a single larger node remains whole.
- Attach immediately preceding comment nodes to the following AST chunk so doc comments contribute
  to its embedding; comments inside declarations are already part of `node.text`.
- Support TypeScript, JavaScript, TSX, JSX, Python, and Rust.
- Preserve complete nodes even when they exceed `chunkLines`.
- Fall back to line chunking when no parser exists, parsing fails, or the syntax tree has errors.
- Keep parser failures internal and typed. `Chunker.chunkText` is total because line fallback remains
  available; extraction and storage failures stay in their existing Effect error channels.
- Keep the persisted `Chunk` schema unchanged. AST chunk IDs include start/end row and column.

## Rationale

Top-level AST nodes preserve semantic declarations without splitting functions or classes. Greedy
packing avoids the tiny-chunk overhead of one embedding per node, while line fallback keeps every
supported text format indexable when no parser is available or source is temporarily malformed.
Reusing the extension registry keeps parser selection in one place.

## Consequences

AST-supported source receives semantic boundaries without producing tiny embeddings for each import or
declaration. Unsupported or temporarily malformed source remains indexable. Parent-child retrieval,
hierarchical embeddings, and result auto-merging require new persisted metadata and remain separate
follow-up slices of issue #83.
