export interface Chunk {
  readonly id: string
  readonly idx: number
  readonly file: string
  readonly startLine: number
  readonly endLine: number
  readonly text: string
}
