# Handoff: Extract `tokenize` to Shared Module

## Context

The `tokenize` function exists in **two identical copies**:
- `src/lib/retrieval/bm25.ts:3` — private function used by `buildBm25Index` and `rankBm25`
- `src/application/query-project.ts:19` — private function used by inlined `routeQuery`

This is a locality violation. If the tokenization heuristic changes (e.g., Unicode identifiers, different camelCase splitting), both copies must be updated.

## What to Do

1. **Create** `src/lib/retrieval/tokenize.ts` with the tokenize function:
   ```typescript
   export const tokenize = (text: string): string[] =>
     text
       .replace(/([a-z])([A-Z])/g, "$1 $2")
       .toLowerCase()
       .split(/[^a-z0-9]+/)
       .filter((t) => t.length > 0)
   ```

2. **Create** `src/lib/retrieval/tokenize.test.ts` with tests covering:
   - Splits on whitespace
   - Splits on punctuation
   - Splits underscores
   - Lowercases all tokens
   - Filters empty tokens
   - Returns empty array for empty string
   - Splits camelCase/PascalCase
   - Splits snake_case

3. **Update** `src/lib/retrieval/bm25.ts`:
   - Remove the private `tokenize` function
   - Add `import { tokenize } from "./tokenize.js"`

4. **Update** `src/application/query-project.ts`:
   - Remove the private `tokenize` function
   - Add `import { tokenize } from "../lib/retrieval/tokenize.js"`

5. **Run quality gates**: `vp check --fix && vp test && vp run lint:fallow`

## Constraints

- Do NOT change the tokenize implementation — it must remain identical to both existing copies
- The function must be exported (not default)
- Tests must cover all existing test cases from the deleted test files (check git history if needed)
- Follow the project's coding standards from `docs/rules/coding-standards.md`

## Files to Modify

- CREATE: `src/lib/retrieval/tokenize.ts`
- CREATE: `src/lib/retrieval/tokenize.test.ts`
- MODIFY: `src/lib/retrieval/bm25.ts`
- MODIFY: `src/application/query-project.ts`

## Success Criteria

- `vp check` passes (format, lint, type)
- `vp test` passes (all existing tests green)
- No duplicate `tokenize` definitions remain
- Both `bm25.ts` and `query-project.ts` import from the shared module
