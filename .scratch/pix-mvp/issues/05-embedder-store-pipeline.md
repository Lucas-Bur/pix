## Parent

.scratch/pix-mvp/PRD.md

## What to build

A tracer bullet that delivers the embedding and storage pipeline end-to-end: embedder service + store service updates. After this slice, chunks are embedded locally using ONNX and stored as `chunks.jsonl` + `vectors.bin`.

## Acceptance criteria

- [ ] `src/services/embedder.ts` uses `@huggingface/transformers` with model `Xenova/all-MiniLM-L6-v2`
- [ ] Embedder config: dtype `q8`, device `cpu`, batch size 16 (configurable)
- [ ] Model cache lives in `.pix/cache/` (not `~/.cache/huggingface/`)
- [ ] Output: `Float32Array[]`, each 384 dims, L2-normalized
- [ ] Mock embedder exists for unit tests (returns deterministic dummy vectors, same format)
- [ ] `src/services/store.ts` writes `chunks.jsonl` (one JSON line per chunk)
- [ ] `src/services/store.ts` writes `vectors.bin` (flat Float32Array, row-major, n×384 floats)
- [ ] `store.ts` updates `config.json` with file mtime cache
- [ ] Integration test for real ONNX embedding as separate script
- [ ] Co-located test files for embedder and store
- [ ] All tests pass (TDD red-green-refactor)
- [ ] `tsc --noEmit` passes
- [ ] `fallow --format json` passes

## Blocked by

- .scratch/pix-mvp/issues/04-scanner-chunker-pipeline.md

Status: needs-triage
