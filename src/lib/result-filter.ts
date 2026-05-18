import type { SearchOptions, SearchResult } from "../domain/ports.js"
import { makeIgnoreFilter, makeOnlyFilter } from "./path-filter.js"

export const filterResults = (
  results: readonly SearchResult[],
  options: SearchOptions | undefined,
): SearchResult[] => {
  const ignoreFilter = makeIgnoreFilter(options?.ignorePaths ?? [])
  const onlyFilter = makeOnlyFilter(options?.onlyPaths ?? [])
  if (!ignoreFilter && !onlyFilter) return [...results]
  return results.filter((r) => {
    if (ignoreFilter && ignoreFilter.ignores(r.file)) return false
    if (onlyFilter && !onlyFilter.ignores(r.file)) return false
    return true
  })
}
