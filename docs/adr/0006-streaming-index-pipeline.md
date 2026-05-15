# ADR 0006: Streaming Index Pipeline

## Status

Accepted

The index pipeline is split into two phases: Phase 1 (extract + chunk) runs fast and collects all chunks, Phase 2 (embed + store) streams batches with a progress bar. This gives a known total for progress display while keeping embedding batched and memory-efficient.

### Pipeline shape

```
Phase 1: Stream.fromIterable(files) → mapEffect(extract) → mapEffect(chunkText) → flatMap → runCollect
Phase 2: Stream.fromIterable(chunks) → grouped(batchSize) → mapEffect(embed) → mapEffect(storeBatch) → drain
```

Scanner stays `Effect<ScanResult>` (discovery operation, not a stream), converted to `Stream` in the use case via `Stream.fromIterable`.

### VectorStore lifecycle

Four new port methods replace the single `store()`: `storeBegin()` (idempotent — cleans stale temp files), `storeBatch()` (append to temp files), `storeCommit()` (atomic rename, return stats), `storeAbort()` (delete temp files). The use case wraps Phase 2 in `d.progress()` which handles the spinner→progress bar transition.

### Embedder simplification

`batch()` removes its internal `BATCH_SIZE` loop and processes whatever array it receives. The use case owns grouping via `Stream.grouped(config.embedder.batchSize)`. Config gains `embedder.batchSize` (default 16).

### Error handling

Non-blocking errors (unsupported formats, extraction failures) are collected in a `Ref<SkippedEntry[]>` and reported as a grouped summary note after the progress bar. Config pattern matches are filtered out. The stream fails on the first fatal error. `storeAbort()` cleans up temp files on failure.

### Progress reporting

Phase 1 uses a spinner ("Processing N files..."). Phase 2 uses a progress bar with known total from Phase 1's `runCollect`. Display switches from spinner to progress bar via `d.progress()`. Final summary shows duration ("Indexed N chunks from M files in X.Xs").

### JSON output

`--json` mode emits a single JSON object at the end: `{ chunks, files, totalLines, byteSize, durationMs, embedderFallback? }`. No intermediate events on stdout.

### Considered Options

- **True single stream (chunking + embedding overlap):** Rejected — chunker is orders of magnitude faster than embedder, so backpressure keeps them in lockstep. Progress bar never gets ahead. Split pipeline gives the total needed for progress display.
- **Two-phase progress (unknown → known transition via buffer):** Rejected — buffer doesn't solve the "know the total" problem. Split is cleaner.
- **`storeTransaction` callback pattern:** Rejected — inversion of control is less idiomatic for streams and harder to test.
- **Adapter tracks stats vs use case:** Adapter returns stats in `storeCommit()` — it already serializes the data, no duplication.

### Consequences

- Memory pressure drops significantly — only one batch of embeddings in memory at a time (Phase 2)
- Progress bar shows percentage with known total from Phase 1
- Four new port methods on VectorStore; all tests and mocks must update
- Embedder `batch()` is simpler but loses internal safety — misconfigured `batchSize` can OOM
- CLI flags (`--batch-size`, `--chunk-concurrency`, etc.) override config for one-off runs
