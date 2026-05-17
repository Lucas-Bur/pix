import ignore from "ignore"

type PathFilter = { ignores(path: string): boolean }

const buildIgnoreFilter = (patterns: readonly string[]): PathFilter => {
  const ig = ignore().add([...patterns])
  return { ignores: (p: string) => ig.ignores(p) }
}

/** Create a filter from gitignore-style patterns. Returns null if patterns is empty. */
export const makeIgnoreFilter = (patterns: readonly string[]): PathFilter | null =>
  patterns.length > 0 ? buildIgnoreFilter(patterns) : null

/** Create a filter that only includes paths matching at least one pattern. Returns null if empty. */
export const makeOnlyFilter = (patterns: readonly string[]): PathFilter | null =>
  patterns.length > 0 ? buildIgnoreFilter(patterns) : null
