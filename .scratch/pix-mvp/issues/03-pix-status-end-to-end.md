## Parent

.scratch/pix-mvp/PRD.md

## What to build

A tracer bullet that delivers `pix status` end-to-end: store service + status command. After this slice, a user can run `pix status` and see index statistics (chunk count, file count, model name, last index time).

## Acceptance criteria

- [ ] `src/services/store.ts` can read `chunks.jsonl` and `vectors.bin` metadata
- [ ] `src/commands/status.ts` implements `pix status` using `@effect/cli`
- [ ] `pix status` shows: chunk count, file count, model name, last index time
- [ ] `pix status --json` outputs structured JSON with same data
- [ ] Co-located test files for status command
- [ ] All tests pass (TDD red-green-refactor)
- [ ] `tsc --noEmit` passes
- [ ] `fallow --format json` passes

## Blocked by

- .scratch/pix-mvp/issues/01-pix-init-end-to-end.md

Status: needs-triage
