import ignore from "ignore"

/** Interface for path filtering during search or scan. */
export interface PathFilter {
  ignores(path: string): boolean
}

/** Create a filter from gitignore-style patterns. Returns null if patterns is empty. */
export const makeIgnoreFilter = (patterns: readonly string[]): PathFilter | null =>
  patterns.length > 0
    ? {
        ignores: (p) =>
          ignore()
            .add([...patterns])
            .ignores(p),
      }
    : null

/** Create a filter that only includes paths matching at least one pattern. Returns null if empty. */
export const makeOnlyFilter = (patterns: readonly string[]): PathFilter | null =>
  patterns.length > 0
    ? {
        ignores: (p) =>
          !ignore()
            .add([...patterns])
            .ignores(p),
      }
    : null
