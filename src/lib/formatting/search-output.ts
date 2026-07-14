import type { SearchResult } from "../../domain/ports.js"

/** Format byte count as human-readable string (e.g. "1.5 MB") */
export const formatBytes = (bytes: number): string => {
  if (bytes === 0) return "0 B"
  const units = ["B", "KB", "MB", "GB"]
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  return `${(bytes / 1024 ** i).toFixed(1)} ${units[i]}`
}

/** Format a result's file location as metadata string */
const formatResultMetadata = (result: SearchResult): string =>
  `${result.file}:${result.startLine}-${result.endLine}`

/** Format a search result for display. Omits chunk text when `noContent` is true. */
export const formatResult = (result: SearchResult, rank: number, noContent = false): string => {
  const prefix = `#${rank}  `
  if (noContent) {
    return `${prefix}${formatResultMetadata(result)} (rel: ${result.rel.toFixed(3)})`
  }
  const contextBefore = result.contextBefore ? `\n${result.contextBefore}` : ""
  const contextAfter = result.contextAfter ? `\n${result.contextAfter}` : ""
  return `${prefix}${formatResultMetadata(result)} (rel: ${result.rel.toFixed(3)})${contextBefore}\n${result.text ?? ""}${contextAfter}`
}

/** Build optional content fields for a single JSON output entry. */
const buildContentFields = (
  r: SearchResult,
  ctxLines: number,
  noContent: boolean,
): Record<string, unknown> => {
  if (noContent) return {}
  return {
    text: r.text ?? "",
    ...(ctxLines > 0 && r.contextBefore && { contextBefore: r.contextBefore }),
    ...(ctxLines > 0 && r.contextAfter && { contextAfter: r.contextAfter }),
  }
}

export const toJsonOutput = (
  results: readonly SearchResult[],
  ctxLines: number,
  noContent = false,
) =>
  results.map((r, i) => ({
    rank: i + 1,
    score: r.score,
    rel: r.rel,
    file: r.file,
    startLine: r.startLine,
    endLine: r.endLine,
    ...buildContentFields(r, ctxLines, noContent),
  }))

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
    const metadata = `${formatResultMetadata(result)}\n`
    const text = result.text ?? ""
    const formatted = `${metadata}${text}${result.contextBefore ? `\n${result.contextBefore}` : ""}${result.contextAfter ? `\n${result.contextAfter}` : ""}`
    const chars = formatted.length

    if (chars <= remaining) {
      budgeted.push(result)
      remaining -= chars
    } else {
      const textBudget = remaining - metadata.length - indicator.length
      if (textBudget <= 0) break
      const truncated = text.slice(0, textBudget)
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
