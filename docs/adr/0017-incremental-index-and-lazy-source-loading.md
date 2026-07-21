# 0017: Incremental index with lazy source loading

## Status

Accepted

## Context

Every `pix index` currently extracts, chunks, and embeds every file. Query loads all persisted chunk
text before ranking although only top-K results are displayed. This wastes indexing time, index space,
and query memory. Issues #84, #95, and #96 address the same index lifecycle and must preserve the
atomic commit behavior from ADR-0006.

## Decision

- Persist file observations in `.pix/index.db` as path, mtime, size, and content hash. Mtime and
  size are cheap change candidates; the content hash is the correctness identity.
- Persist only chunk metadata in SQLite: stable ID, file membership, line range, exact
  source offsets, and hash of the exact text sent to the embedder. Text and context remain in source.
- Reuse unchanged chunk metadata, vectors, BM25 terms, and identifier postings. Added and changed
  files are extracted and chunked; deleted files are omitted. Renamed content may reuse embeddings
  through its chunk content hash.
- Use active chunk embedding rows as the primary embedding cache. Store only displaced historical
  embeddings in the `embedding_cache` table; never duplicate active vectors there. Cache identity
  includes chunk content hash, model, dimensions, and dtype. Historical entries remain until
  `pix cache clear` explicitly removes them.
- `pix query` first ensures the index is fresh. Missing indexes, source changes, and embedding-contract
  changes are repaired automatically before ranking. A failed refresh leaves the previous committed
  snapshot untouched and fails the query.
- Rank from chunk metadata, vectors, BM25, and identifier indexes. Load source text and requested
  context only after filtering and top-K selection. `--no-content` performs no source hydration.
- Persisted data evolves through Effect SQL migrations. The flat-file to SQLite transition uses a
  clean re-index rather than importing generated data.
- Do not add hierarchy fields for #146, #147, or #148. Those behaviors remain separate changes.

## Rationale

One self-healing query command removes the error-help-command retry loop and optimizes total user
time, even when the first query waits for indexing. Content hashes protect correctness when mtimes are
preserved or changed spuriously. Per-chunk cache keys reuse unaffected embeddings after edits and
renames without coupling vectors to whole-file hashes. Exact offsets ensure displayed text is the text
that produced the ranked embedding.

Rebuilding the complete snapshot in a SQLite transaction keeps reads simple and preserves
commit/rollback semantics.
Retained BM25 and identifier postings are remapped to new global chunk indexes, avoiding source reads
for unchanged files.

## Consequences

- Normal query latency includes a source scan and may include indexing or model download work.
- `pix index` remains useful for deliberate pre-warming but is not required before query.
- The historical embedding cache can grow until explicitly cleared, while active vectors remain in
  the chunks table.
- Flat-file indexes are rebuilt into SQLite and their obsolete generated artifacts are removed.
- Query memory no longer scales with total persisted source text.
