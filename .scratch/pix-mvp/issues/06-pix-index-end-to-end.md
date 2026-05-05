## Parent

.scratch/pix-mvp/PRD.md

## What to build

A tracer bullet that delivers `pix index` end-to-end: all services + index command. After this slice, running `pix index` scans, chunks, embeds, and stores the entire project index.

## Acceptance criteria

- [ ] `src/commands/index-cmd.ts` implements `pix index` using `@effect/cli`
- [ ] Pipeline: read config → scan (parallel, concurrency: inherit) → chunk (parallel) → embed (serial batches, concurrency: 1) → store
- [ ] `pix index --force` re-indexes all files ignoring mtime cache
- [ ] `pix index --verbose` shows progress per batch
- [ ] `pix index --json` outputs final JSON: `{ "chunks": N, "files": N, "duration": "Xs" }`
- [ ] On failure, exits with code ≠ 0 and outputs JSON error: `{ "error": true, "code": "...", "message": "..." }`
- [ ] `chunks.jsonl` and `vectors.bin` are overwritten atomically
- [ ] Co-located test file for index command
- [ ] All tests pass (TDD red-green-refactor)
- [ ] `tsc --noEmit` passes
- [ ] `fallow --format json` passes
- [ ] Build with `vp pack` produces working CLI binary

## Blocked by

- .scratch/pix-mvp/issues/05-embedder-store-pipeline.md

Status: needs-triage
