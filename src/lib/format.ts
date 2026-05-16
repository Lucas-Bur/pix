import type { SearchResult } from "../domain/ports.js"

/** Format byte count as human-readable string (e.g. "1.5 MB") */
export const formatBytes = (bytes: number): string => {
  if (bytes === 0) return "0 B"
  const units = ["B", "KB", "MB", "GB"]
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  return `${(bytes / 1024 ** i).toFixed(1)} ${units[i]}`
}

/**
 * Estimate token count using a ~4 chars-per-token heuristic. Suitable for LLM context budget
 * calculations.
 */
export const countTokens = (text: string): number =>
  text.length === 0 ? 0 : Math.max(1, Math.ceil(text.length / 4))

/** Truncate text to fit within a token budget, appending ` [...]` if truncated. */
export const truncateToTokens = (
  text: string,
  maxTokens: number,
): { text: string; truncated: boolean } => {
  if (maxTokens <= 0) return { text: "", truncated: true }
  const currentTokens = countTokens(text)
  if (currentTokens <= maxTokens) return { text, truncated: false }

  const indicator = " [...]"
  const indicatorTokens = countTokens(indicator)
  const targetChars = Math.max(0, maxTokens - indicatorTokens) * 4
  const truncated = text.slice(0, targetChars)
  return { text: `${truncated}${indicator}`, truncated: true }
}

/** Format a SearchResult as a single string for token budget calculation. */
const formatResultForTokens = (r: SearchResult): string =>
  `${r.file}:${r.startLine}-${r.endLine}\n${r.text}${r.contextBefore ? `\n${r.contextBefore}` : ""}${r.contextAfter ? `\n${r.contextAfter}` : ""}`

/**
 * Apply a token budget to search results. Returns results in score order capped by the budget. The
 * last result may be truncated to fit the remaining budget.
 */
export const applyTokenBudget = (
  results: readonly SearchResult[],
  maxTokens?: number,
): { results: readonly SearchResult[] } => {
  if (!maxTokens || maxTokens <= 0) return { results }

  const budgeted: SearchResult[] = []
  let remaining = maxTokens

  for (const result of results) {
    const formatted = formatResultForTokens(result)
    const tokens = countTokens(formatted)

    if (tokens <= remaining) {
      budgeted.push(result)
      remaining -= tokens
    } else {
      const truncated = truncateToTokens(result.text, remaining)
      budgeted.push({ ...result, text: truncated.text })
      break
    }
  }

  return { results: budgeted }
}
