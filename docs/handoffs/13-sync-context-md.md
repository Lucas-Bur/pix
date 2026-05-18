# Handoff: Sync CONTEXT.md with Current Codebase

## Context

After the architecture restructuring, `CONTEXT.md` references many paths that no longer exist:
- `src/lib/query-router.ts` → moved to `src/application/query-project.ts` (inlined)
- `src/lib/tokenize.ts` → moved to `src/lib/retrieval/bm25.ts` (private)
- `src/lib/bm25.ts` → moved to `src/lib/retrieval/bm25.ts`
- `src/lib/dense.ts` → moved to `src/lib/retrieval/dense.ts`
- `src/lib/rrf.ts` → moved to `src/lib/retrieval/rrf.ts`
- `src/lib/result-filter.ts` → moved to `src/lib/filtering/result-filter.ts`
- `src/lib/path-filter.ts` → merged into `src/lib/filtering/result-filter.ts`
- `src/lib/fs-error.ts` → moved to `src/lib/errors/fs-error.ts`
- `src/lib/platform-error.ts` → moved to `src/lib/errors/platform-error.ts`
- `src/lib/error-format.ts` → moved to `src/lib/errors/error-format.ts`
- `src/lib/format.ts` → moved to `src/lib/formatting/format.ts`
- `src/lib/search-output.ts` → moved to `src/lib/formatting/search-output.ts`
- `src/lib/validation.ts` → moved to `src/lib/config/validation.ts`
- `src/lib/config-merge.ts` → moved to `src/lib/config/config-merge.ts`
- `src/lib/extension.ts` → moved to `src/lib/config/extension.ts`
- `src/lib/vector-math.ts` → moved to `src/lib/vectors/vector-math.ts`
- `src/lib/vector-codec.ts` → moved to `src/lib/vectors/vector-codec.ts`
- `src/services/processors/` → merged into `src/lib/config/processors.ts`
- `src/display/Display.ts` → split into `clack-display.ts`, `json-display.ts`, `silent-display.ts`, `entries.ts`, `logging.ts`

## What to Do

1. **Read** `CONTEXT.md` at the repo root
2. **Search** for all references to old paths listed above
3. **Update** each reference to the correct new path
4. **Update** the Display Service section to reflect the new split structure
5. **Update** the Scorer section to reflect that `tokenize` is now private in `bm25.ts` and `routeQuery` is inlined in `query-project.ts`
6. **Update** the ContentExtractor/Processor section to reflect `src/lib/config/processors.ts`
7. **Do NOT** change any domain terminology — only file paths
8. **Do NOT** add new sections — only fix existing references

## Key Sections to Review

- **BM25 Index** — references `src/lib/bm25.ts`
- **Chunk** — may reference old paths
- **Scanner** — check for old processor paths
- **Query Routing** — references `src/lib/query-router.ts`
- **Scorer** — references `src/lib/` files
- **Display Service** — references `src/display/Display.ts`
- **ContentExtractor** — references `src/services/processors/`
- **ProcessorError** — references `src/services/processors/`
- **Config** — references `src/lib/config-merge.ts`

## Constraints

- Only update file paths — do NOT change domain definitions
- Do NOT restructure CONTEXT.md — keep the same sections
- Do NOT add ADR references that don't exist
- Preserve all existing domain language and terminology

## Files to Modify

- MODIFY: `CONTEXT.md`

## Success Criteria

- No references to deleted/moved files remain in CONTEXT.md
- All file paths point to existing files
- Domain definitions are unchanged
- The file is still readable and well-structured
