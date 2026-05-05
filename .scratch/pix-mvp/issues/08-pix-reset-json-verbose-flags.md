## Parent

.scratch/pix-mvp/PRD.md

## What to build

Complete the CLI: `pix reset` command, and `--json` / `--verbose` flags across all commands. After this slice, all MVP commands are complete with agent-ready structured output.

## Acceptance criteria

- [ ] `src/commands/reset.ts` implements `pix reset` using `@effect/cli`
- [ ] `pix reset` deletes `chunks.jsonl` + `vectors.bin`, keeps `config.json`
- [ ] All commands (`init`, `index`, `query`, `status`, `reset`) support `--json` flag
- [ ] `--json` outputs structured JSON on stdout (not stderr)
- [ ] Error responses in JSON format: `{ "error": true, "code": "...", "message": "..." }`
- [ ] `pix status --json` outputs: `{ "chunks": N, "files": N, "model": "...", "lastIndex": "..." }`
- [ ] `src/index.ts` wires all commands with `@effect/cli` Command.run
- [ ] Build with `vp pack` produces working `pix` binary
- [ ] Binary runs under `npx @lucas-bur/pix`, `npm run`, and `bunx`
- [ ] Co-located test files updated for all commands
- [ ] All tests pass (TDD red-green-refactor)
- [ ] `tsc --noEmit` passes
- [ ] `fallow --format json` passes
- [ ] `CONTEXT.md` updated with any new terms from implementation

## Blocked by

- .scratch/pix-mvp/issues/06-pix-index-end-to-end.md
- .scratch/pix-mvp/issues/07-pix-query-end-to-end.md

Status: needs-triage
