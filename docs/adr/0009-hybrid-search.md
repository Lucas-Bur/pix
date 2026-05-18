# 0009: Hybrid search with BM25 + RRF fusion

Hybrid search combines semantic (cosine similarity on embeddings) and lexical (BM25 on raw text) retrieval via Reciprocal Rank Fusion (RRF). BM25 corpus statistics are pre-built at index time and stored in `.pix/bm25.json`. Scorers are pure functions in `src/lib/` — no new ports. QueryProject orchestrates parallel scoring via `Effect.all` and fuses ranked lists with RRF (k=60).

**Why not query-time BM25**: BM25 needs corpus-level statistics (IDF, average chunk length) computed over all chunks. Phase 3 removes chunk text from `chunks.jsonl` — at that point re-computing BM25 from source files per query would be prohibitively expensive. Pre-building at index time survives Phase 3.

**Why pure functions over ports**: BM25 and Dense scoring are stateless transformations. The only I/O (loading index data) remains in IndexStore. Adding a new retrieval path (e.g. cross-encoder reranker) means adding a scoring function + wiring it into `Effect.all` — no new port/layer.

**Why RRF over score normalization**: BM25 and cosine similarity produce incomparable score distributions ([0,∞] vs [-1,1]). RRF uses rank position only (`1 / (k + rank)`), trivially extensible to N retrieval paths.
