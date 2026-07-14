# Context Lines Stored in chunks.jsonl

## Status

Superseded by ADR-0017

## Context

Semantic search returns code snippets with surrounding context (N lines before/after the match). Two implementation approaches were considered:

1. **Store context in chunks.jsonl at index time** — Write context lines alongside chunk text during indexing. Query-time retrieval is instant but increases storage size.

2. **Live-fetch from source file at query time** — Store only chunk metadata. Read source file at query time to fetch surrounding lines. Lower storage but adds I/O latency and complexity (file may have changed since indexing).

## Decision

We store context lines in `chunks.jsonl` at index time for MVP simplicity.

## Rationale

- **Simplicity**: No need for cache invalidation or file-change detection during query
- **Fast queries**: Context is immediately available, no additional I/O
- **Clear migration path**: Phase 3 (incremental indexing via mtime cache) will bring index freshness checks. At that point, we can switch to live-fetch and remove `text`/`context` fields from stored chunks.

## Consequences

- **Positive**: Query performance is fast and predictable; implementation is straightforward
- **Negative**: Larger `chunks.jsonl` storage; context may be stale if file changes between indexing and query
- **Deferred**: Live-fetch implementation deferred to Phase 3 when index freshness lands
