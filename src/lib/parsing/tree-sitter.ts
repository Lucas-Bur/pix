import type Parser from "tree-sitter"

const TREE_SITTER_INPUT_SLICE_SIZE = 4_096

/** Parse source through bounded callbacks so tree-sitter can handle inputs larger than 32 KiB. */
export const parseTreeSitterSource = (parser: Parser, source: string): Parser.Tree =>
  parser.parse((offset) => source.slice(offset, offset + TREE_SITTER_INPUT_SLICE_SIZE))
