import Parser from "tree-sitter"

import type { Identifier, IdentifierKind } from "../../domain/identifier.js"

/**
 * Walk a tree-sitter syntax tree and extract named identifiers from nodes whose type is in
 * `mapKind`.
 *
 * For each matched node, the function reads the `name` field via `node.childForFieldName("name")`.
 * This is the conventional field name across tree-sitter grammars for declaration nodes
 * (function_declaration, class_declaration, variable_declarator, ...). The walker recurses into
 * children so nested declarations (e.g. functions inside functions, methods inside classes) are all
 * captured.
 *
 * Pure: no I/O, no Effect. Caller provides the already-configured parser (set up once with the
 * language grammar) and a chunkIndex to attach to every identifier extracted from this text.
 */
export const extractIdentifiers = (
  parser: Parser,
  mapKind: Record<string, IdentifierKind>,
  text: string,
  chunkIndex: number,
): readonly Identifier[] => {
  const tree = parser.parse(text)
  const identifiers: Identifier[] = []

  const walk = (node: Parser.SyntaxNode): void => {
    const kind = mapKind[node.type]
    if (kind !== undefined) {
      const nameNode = node.childForFieldName("name")
      if (nameNode !== null) {
        identifiers.push({
          name: nameNode.text,
          kind,
          chunkIndex,
        })
      }
    }
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (child !== null) walk(child)
    }
  }

  walk(tree.rootNode)
  return identifiers
}
