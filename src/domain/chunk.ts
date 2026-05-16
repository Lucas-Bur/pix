/** A single chunk of source code produced by the chunker. One chunk = N lines with overlap. */
export interface Chunk {
  /** SHA1(file:startLine).slice(0, 12) — unique per start position. */
  readonly id: string
  /** Zero-based index within the file's chunk sequence. */
  readonly idx: number
  /** Absolute or repo-relative file path. */
  readonly file: string
  /** 1-based start line of this chunk in the source file. */
  readonly startLine: number
  /** 1-based end line (inclusive) of this chunk in the source file. */
  readonly endLine: number
  /** The chunk's source text. */
  readonly text: string
  /** Lines immediately preceding the chunk, up to overlapLines count. Empty string for first chunk. */
  readonly contextBefore?: string
  /** Lines immediately following the chunk, up to overlapLines count. Empty string for last chunk. */
  readonly contextAfter?: string
}
