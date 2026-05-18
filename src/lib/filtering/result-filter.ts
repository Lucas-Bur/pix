import ignore from "ignore"

import type { SearchOptions, SearchResult } from "../../domain/ports.js"

type PathFilter = { ignores(path: string): boolean }

const buildIgnoreFilter = (patterns: readonly string[]): PathFilter => {
  const ig = ignore().add([...patterns])
  return { ignores: (p: string) => ig.ignores(p) }
}

const makeIgnoreFilter = (patterns: readonly string[]): PathFilter | null =>
  patterns.length > 0 ? buildIgnoreFilter(patterns) : null

const makeOnlyFilter = (patterns: readonly string[]): PathFilter | null =>
  patterns.length > 0 ? buildIgnoreFilter(patterns) : null

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
