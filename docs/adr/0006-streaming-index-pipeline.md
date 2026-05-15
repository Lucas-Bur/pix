# ADR 0006: Streaming Index Pipeline

## Status

Proposed

The index pipeline is converted from sequential `Effect.forEach` to an Effect Stream topology: Scanner → ContentExtractor → Chunker → Embedder → VectorStore. True streaming with backpressure — chunking and embedding overlap, slow embedding throttles chunking automatically.

### Pipeline shape

`Stream.fromIterable(files) → mapEffect(extract) → mapEffect(chunkText) → flatMap → grouped(batchSize) → mapEffect(embed) → mapEffect(storeBatch) → drain`

Scanner stays `Effect<ScanResult>` (discovery operation, not a stream), converted to `Stream` in the use case via `Stream.fromIterable`.

### VectorStore lifecycle

Four new port methods replace the single `store()`: `storeBegin()` (open temp file handles), `storeBatch()` (append to temp files), `storeCommit()` (close handles, atomic rename, return stats), `storeAbort()` (close handles, delete temp files). The use case wraps the stream in `Effect.acquireUseRelease`. `storeBegin()` is idempotent — cleans up stale `.tmp` files from previous failed runs.

### Embedder simplification

`batch()` removes its internal `BATCH_SIZE` loop and processes whatever array it receives. The use case owns grouping via `Stream.grouped(config.embedder.batchSize)`. Config gains `embedder.batchSize` (default 16).

### Error handling

Non-blocking errors (unsupported formats, extraction failures) are collected in a `Ref<SkippedEntry[]>` and reported as a summary note at the end. The stream fails on the first fatal error. `storeAbort()` cleans up temp files on failure.

### Progress reporting

Progress is tapped after each `storeBatch` (every ~16 chunks). Display shows "X chunks embedded" throughout; the final summary from `storeCommit()` gives totals. No two-phase "unknown → known" transition — in true streaming, chunking and embedding finish at roughly the same time due to backpressure.

### Considered Options

- **Hybrid pipeline (chunk all first, then stream embed):** Rejected — defeats the purpose of streaming. Easy to switch to later by inserting one `runCollect` if needed.
- **Two-phase progress (unknown → known transition):** Rejected — requires buffering after chunking to let it finish ahead of embedding, which reintroduces memory pressure.
- **`storeTransaction` callback pattern:** Rejected — inversion of control is less idiomatic for streams and harder to test.
- **Adapter tracks stats vs use case:** Adapter returns stats in `storeCommit()` — it already serializes the data, no duplication.

### Consequences

- Memory pressure drops significantly — only one batch of chunks + embeddings in memory at a time
- Progress feedback is simpler (absolute count, no percentage) but still meaningful
- Four new port methods on VectorStore; all tests and mocks must update
- Embedder `batch()` is simpler but loses internal safety — misconfigured `batchSize` can OOM
