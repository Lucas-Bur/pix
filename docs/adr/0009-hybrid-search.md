# 0009: Hybrid search with BM25 + RRF fusion

## Status

Accepted

## Context

pix initially used dense-only semantic search via cosine similarity on embeddings. Adding lexical retrieval improves recall for exact identifier matches that embeddings may miss.

## Decision

Adopt hybrid retrieval combining BM25 lexical search with dense semantic ranking, fused via Reciprocal Rank Fusion (RRF, k=60). BM25 corpus statistics are pre-built at index time and stored in the index database. QueryProject orchestrates retrieval and fuses ranked lists with RRF. ADR-0018 later moved production dense ranking behind `IndexStore` so SQLite can execute it without loading all vectors.

## Rationale

**Why not query-time BM25**: BM25 needs corpus-level statistics (IDF, average chunk length) computed over all chunks. Persisted chunks contain metadata but no source text, so re-computing BM25 from source files per query would be prohibitively expensive. Pre-building at index time preserves lazy source loading.

**Why pure functions over ports**: BM25 and identifier scoring remain stateless transformations. Dense scoring was originally pure; ADR-0018 retains that implementation as a reference while production ranking executes at the SQLite storage boundary.

**Why RRF over score normalization**: BM25 and cosine similarity produce incomparable score distributions ([0,∞] vs [-1,1]). RRF uses rank position only (`1 / (k + rank)`), trivially extensible to N retrieval paths.

## Consequences

- Better lexical + semantic recall, especially for exact identifier matches
- Additional persisted BM25 payload managed by IndexStore
- Query routing adjusts BM25/dense weights based on query token count
