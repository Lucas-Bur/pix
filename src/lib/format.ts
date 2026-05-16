import type { SearchResult } from "../domain/ports.js"

/** Format byte count as human-readable string (e.g. "1.5 MB") */
export const formatBytes = (bytes: number): string => {
  if (bytes === 0) return "0 B"
  const units = ["B", "KB", "MB", "GB"]
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  return `${(bytes / 1024 ** i).toFixed(1)} ${units[i]}`
}

/**
 * Apply a character budget to search results. Returns results in score order capped by the budget.
 * The last result may be truncated to fit the remaining budget. Character count includes file path,
 * line numbers, chunk text, and context lines.
 */
export const applyCharBudget = (
  results: readonly SearchResult[],
  maxChars?: number,
): { results: readonly SearchResult[] } => {
  if (!maxChars || maxChars <= 0) return { results }

  const budgeted: SearchResult[] = []
  let remaining = maxChars

  for (const result of results) {
    const indicator = " [...]"
    const metadata = `${result.file}:${result.startLine}-${result.endLine}\n`
    const formatted = `${metadata}${result.text}${result.contextBefore ? `\n${result.contextBefore}` : ""}${result.contextAfter ? `\n${result.contextAfter}` : ""}`
    const chars = formatted.length

    if (chars <= remaining) {
      budgeted.push(result)
      remaining -= chars
    } else {
      const textBudget = remaining - metadata.length - indicator.length
      if (textBudget <= 0) break
      const truncated = result.text.slice(0, textBudget)
      budgeted.push({
        ...result,
        text: `${truncated}${indicator}`,
        contextBefore: null,
        contextAfter: null,
      })
      break
    }
  }

  return { results: budgeted }
}
