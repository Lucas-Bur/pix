## Parent

.scratch/pix-mvp/PRD.md

## What to build

A tracer bullet that delivers `pix query` end-to-end: query command with cosine similarity search. After this slice, running `pix query "text"` returns semantically relevant code snippets.

## Acceptance criteria

- [ ] `src/commands/query.ts` implements `pix query "<text>"` using `@effect/cli`
- [ ] Loads `chunks.jsonl` + `vectors.bin` in-memory (no FAISS for MVP)
- [ ] Computes cosine similarity between query embedding and all chunk vectors
- [ ] `pix query --top N` limits results to N items (default: 5)
- [ ] `pix query --json` outputs JSON array: `[{ "score": 0.91, "file": "...", "startLine": N, "endLine": N, "text": "..." }]`
- [ ] `pix query --context-lines N` includes N lines of context before/after match (via file read)
- [ ] Results include: file path, start line, end line, relevance score, code text, context before/after
- [ ] Query embedding uses same ONNX model as index
- [ ] Co-located test file for query command
- [ ] All tests pass (TDD red-green-refactor)
- [ ] `tsc --noEmit` passes
- [ ] `fallow --format json` passes

## Blocked by

- .scratch/pix-mvp/issues/06-pix-index-end-to-end.md

Status: needs-triage
