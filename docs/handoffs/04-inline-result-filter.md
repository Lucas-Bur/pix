# Handoff: Inline `result-filter.ts` into `query-project.ts`

## Context

`src/lib/filtering/result-filter.ts` is 30 lines. It exports a single function `filterResults` that wraps the `ignore` package with helper functions (`buildIgnoreFilter`, `makeIgnoreFilter`, `makeOnlyFilter`). The module is shallow — the interface (one exported function) is nearly as complex as the implementation.

The only caller is `src/application/query-project.ts`.

## What to Do

1. **Move** the entire content of `result-filter.ts` into `query-project.ts` as a private function (but keep it **exported** so it remains independently testable):
   ```typescript
   export const filterResults = (
     results: readonly SearchResult[],
     options: SearchOptions | undefined,
   ): SearchResult[] => {
     const ignoreFilter = options?.ignorePaths && options.ignorePaths.length > 0
       ? ignore().add([...options.ignorePaths])
       : null
     const onlyFilter = options?.onlyPaths && options.onlyPaths.length > 0
       ? ignore().add([...options.onlyPaths])
       : null
     if (!ignoreFilter && !onlyFilter) return [...results]
     return results.filter((r) => {
       if (ignoreFilter && ignoreFilter.ignores(r.file)) return false
       if (onlyFilter && !onlyFilter.ignores(r.file)) return false
       return true
     })
   }
   ```

2. **Add** `import ignore from "ignore"` to `query-project.ts`

3. **Remove** the import `import { filterResults } from "../lib/filtering/result-filter.js"` from `query-project.ts`

4. **Move** `src/lib/filtering/result-filter.test.ts` to `src/application/result-filter.test.ts` (or keep it in `src/lib/filtering/` but update the import path to `../application/query-project.js`)

5. **Delete** `src/lib/filtering/result-filter.ts`

6. **Delete** `src/lib/filtering/` directory if empty (check for other files first)

7. Run quality gates: `vp check --fix && vp test && vp run lint:fallow`

## Constraints

- `filterResults` MUST remain exported so it can be independently tested
- The test file must be updated to import from the new location
- The `ignore` package import must be added to `query-project.ts`
- Do NOT change the filtering logic — only move it

## Files to Modify

- MODIFY: `src/application/query-project.ts`
- MODIFY or MOVE: `src/lib/filtering/result-filter.test.ts`
- DELETE: `src/lib/filtering/result-filter.ts`
- DELETE: `src/lib/filtering/` (if empty after deletion)

## Success Criteria

- `filterResults` is defined in `query-project.ts` and exported
- No files import from `lib/filtering/result-filter.js`
- Tests for `filterResults` still pass
- `vp check` passes
- `vp test` passes
