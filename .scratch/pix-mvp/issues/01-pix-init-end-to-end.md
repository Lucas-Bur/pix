## Parent

.scratch/pix-mvp/PRD.md

## What to build

A tracer bullet that delivers `pix init` end-to-end: shared types + store service + init command. After this slice, a user can run `pix init` and get a valid `.pix/config.json` with default settings.

## Acceptance criteria

- [ ] `src/types.ts` exists with `Config` interface matching `config.json` schema (model, dims, chunkLines, overlapLines, files map)
- [ ] `src/types.ts` exports whitelist extension constants
- [ ] `src/services/store.ts` can read and write `config.json`
- [ ] `src/commands/init.ts` implements `pix init` using `@effect/cli`
- [ ] Running `pix init` creates `.pix/` directory and `config.json` with defaults
- [ ] `pix init` outputs reminder to add `.pix` to `.gitignore`
- [ ] Co-located test files for types, store, and init command
- [ ] All tests pass (TDD red-green-refactor)
- [ ] `tsc --noEmit` passes
- [ ] `fallow --format json` passes

## Blocked by

None - can start immediately

Status: needs-triage
