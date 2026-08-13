import type Parser from "tree-sitter"

const TREE_SITTER_INPUT_SLICE_SIZE = 4_096

/** UTF-16 and line boundaries used to translate parser input offsets. */
interface SourceOffsets {
  readonly lineOffsets: readonly number[]
}

const buildSourceOffsets = (source: string): SourceOffsets => {
  const lineOffsets = [0]

  for (let stringOffset = 0; stringOffset < source.length;) {
    const codePoint = source.codePointAt(stringOffset)!
    const codeUnitLength = codePoint > 0xffff ? 2 : 1
    const nextStringOffset = stringOffset + codeUnitLength
    if (source[stringOffset] === "\n") lineOffsets.push(nextStringOffset)
    stringOffset = nextStringOffset
  }

  return { lineOffsets }
}

const stringOffsetForPosition = (
  source: string,
  offsets: SourceOffsets,
  position: Parser.Point,
): number => {
  const lineOffset = offsets.lineOffsets[position.row]
  return lineOffset === undefined
    ? source.length
    : Math.min(lineOffset + position.column, source.length)
}

const boundedSourceSlice = (source: string, start: number): string => {
  return source.slice(start, start + TREE_SITTER_INPUT_SLICE_SIZE)
}

/** Parse source through bounded callbacks so tree-sitter can handle inputs larger than 32 KiB. */
export const parseTreeSitterSource = (parser: Parser, source: string): Parser.Tree => {
  const offsets = buildSourceOffsets(source)

  return parser.parse((offset, position) => {
    // The Node binding uses UTF-16 indexes for callback offsets and positions. Keep the offset
    // fallback because tree-sitter calls the input function without a position while rebuilding
    // node text.
    const stringOffset =
      position === undefined ? offset : stringOffsetForPosition(source, offsets, position)
    return boundedSourceSlice(source, stringOffset)
  })
}
