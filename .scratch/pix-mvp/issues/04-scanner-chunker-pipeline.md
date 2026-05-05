## Parent

.scratch/pix-mvp/PRD.md

## What to build

A tracer bullet that delivers the file scanning and chunking pipeline end-to-end: types + scanner service + chunker service. After this slice, source files are discovered (gitignore-aware, extension whitelist) and chunked into overlapping windows.

## Acceptance criteria

- [ ] `src/types.ts` has `Chunk` interface matching `chunks.jsonl` schema (id, idx, file, startLine, endLine, text)
- [ ] `src/services/scanner.ts` uses `fast-glob` + `ignore` for gitignore-aware scanning
- [ ] Scanner respects whitelist extensions from config (default: .ts, .tsx, .js, .jsx, .py, .rs, .go, .java, .md, .json, .yaml, .yml, etc.)
- [ ] Scanner always ignores: `.pix`, `node_modules`, `.git`, `dist`, `build`, `.next`
- [ ] `src/services/chunker.ts` implements line-based sliding window (default: 60 lines, 10 overlap)
- [ ] Chunker skips chunks < 20 characters
- [ ] Chunk-ID = `sha1(file:startLine).slice(0, 12)`
- [ ] Co-located test files for scanner and chunker
- [ ] All tests pass (TDD red-green-refactor)
- [ ] `tsc --noEmit` passes
- [ ] `fallow --format json` passes

## Blocked by

- .scratch/pix-mvp/issues/01-pix-init-end-to-end.md

Status: needs-triage
