import type { SearchResult } from "../domain/ports.js"

/** Format a single result for human-readable output */
export const formatResult = (result: SearchResult): string => {
  const contextBefore = result.contextBefore ? `\n${result.contextBefore}` : ""
  const contextAfter = result.contextAfter ? `\n${result.contextAfter}` : ""
  return `${formatResultMetadata(result)} (score: ${result.score.toFixed(3)})${contextBefore}\n${result.text}${contextAfter}`
}

/** Format a result as a lightweight location reference (no text content). */
export const formatLocation = (result: SearchResult): string =>
  `${formatResultMetadata(result)} (score: ${result.score.toFixed(3)})`

/** Return a compact location string: file:startLine-endLine */
export const formatResultMetadata = (result: SearchResult): string =>
  `${result.file}:${result.startLine}-${result.endLine}`

/** Build optional content fields for a single JSON output entry. */
const buildContentFields = (
  r: SearchResult,
  ctxLines: number,
  noContent: boolean,
): Record<string, unknown> => {
  if (noContent) return {}
  return {
    text: r.text,
    ...(ctxLines > 0 && r.contextBefore && { contextBefore: r.contextBefore }),
    ...(ctxLines > 0 && r.contextAfter && { contextAfter: r.contextAfter }),
  }
}

export const toJsonOutput = (
  results: readonly SearchResult[],
  ctxLines: number,
  noContent = false,
) =>
  results.map((r) => ({
    score: r.score,
    file: r.file,
    startLine: r.startLine,
    endLine: r.endLine,
    ...buildContentFields(r, ctxLines, noContent),
  }))
