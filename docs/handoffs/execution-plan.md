# Architecture Deepening — Execution Plan

## Overview

This document coordinates the architectural improvements identified during the `/improve-codebase-architecture` session. Tasks are grouped into batches based on dependency order. Each task has a detailed handoff document in `docs/handoffs/`.

## Batch 1 — No Blockers (Run in Parallel)

| Task | Handoff | Scope |
|------|---------|-------|
| 1. Extract `tokenize` to shared module | `01-extract-tokenize.md` | Create `lib/retrieval/tokenize.ts`, update 2 imports |
| 2. Delete `Display.ts` barrel | `02-delete-display-barrel.md` | Remove barrel, update 10 importers |
| 4. Inline `result-filter.ts` | `04-inline-result-filter.md` | Move into `query-project.ts` as exported fn |
| 5. Split `vector-math.ts` | `05-split-vector-math.md` | `vector-math.ts` + `vector-serialization.ts` |
| 11. Convert validation errors to TaggedError | `11-convert-validation-errors.md` | `JsonSyntaxError`/`SchemaValidationError` → `Data.TaggedError` |
| 13. Sync CONTEXT.md | `13-sync-context-md.md` | Update all stale file paths |

**After Batch 1 completes:** Commit all changes, verify `vp check && vp test && vp run lint:fallow`.

## Batch 2 — After Batch 1 Commits

| Task | Handoff | Scope |
|------|---------|-------|
| 7. `content-extractor.ts` processor map config | TBD | Make configurable via port |
| 8. Extract `index-project.ts` helpers | TBD | New `lib/indexing/` directory |
| 9. Split `index-store.ts` | TBD | Extract BM25 + transaction logic |
| 12. Add missing tests | TBD | `search-output.ts`, `config-merge.ts`, `logging.ts`, `interactive-state.ts` |

## Batch 3 — After Batch 2 Commits

| Task | Handoff | Scope |
|------|---------|-------|
| 14. Deduplicate `logging.ts` error mapping | TBD | Reuse `fs-error.ts` |
| 15. Clean up reexports | TBD | Sweep all barrel files |

## Skipped Items (Decisions Recorded)

| # | Issue | Reason |
|---|-------|--------|
| 3 | `dense.ts` shallow | ADR-0011: pattern consistency outweighs line-count |
| 6 | `domain/ports.ts` too large | Not worth the churn — single source of truth |
| 10 | Layer violations (ConfigStoreLive) | Pragmatic choice — one implementation, testable |

## Quality Gates

Every batch must pass:
1. `vp check` (format, lint, type check)
2. `vp test` (all tests green)
3. `vp run lint:fallow` (code quality)

## How to Use

1. Commit current state before starting any batch
2. Launch subagents with the handoff document as prompt
3. Review each subagent's output against the success criteria
4. Commit after all tasks in a batch pass quality gates
5. Proceed to next batch
