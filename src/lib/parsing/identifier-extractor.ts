import Parser from "tree-sitter"

import type { Identifier, IdentifierKind } from "../../domain/identifier.js"

/**
 * Walk a tree-sitter syntax tree and extract named identifiers from nodes whose type is in
 * `mapKind`.
 *
 * For matched nodes the function reads the `name` field via `node.childForFieldName("name")` -- the
 * conventional field name across tree-sitter grammars for declaration nodes (function_declaration,
 * class_declaration, variable_declarator, ...). The walker recurses into children so nested
 * declarations (e.g. functions inside functions, methods inside classes) are all captured.
 *
 * For `variable_declarator` the "name" field can be a destructuring pattern (`object_pattern` or
 * `array_pattern`). In that case the pattern's text would index `{ foo }` / `[bar]` as the
 * identifier name -- which is wrong. The walker instead descends into the pattern and emits one
 * identifier per bound name.
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

  /**
   * Recursively collect the names bound by a destructuring pattern. Returns an empty array for
   * patterns that bind nothing (e.g. `[]`, `{}`).
   */
  const collectBoundNames = (node: Parser.SyntaxNode): readonly string[] => {
    switch (node.type) {
      case "identifier":
      case "shorthand_property_identifier_pattern":
        return [node.text]
      case "object_pattern":
      case "array_pattern":
      case "rest_pattern":
        return node.namedChildren.flatMap((c) => (c === null ? [] : collectBoundNames(c)))
      case "pair_pattern":
      case "pair": {
        const value = node.childForFieldName("value")
        return value === null ? [] : collectBoundNames(value)
      }
      case "assignment_pattern": {
        const left = node.childForFieldName("left")
        return left === null ? [] : collectBoundNames(left)
      }
      default:
        return [node.text]
    }
  }

  /**
   * Extract the bound names for a matched node. For most declaration types this is the `name` field
   * as a single string; for `variable_declarator` the `name` field can be a destructuring pattern,
   * in which case we descend and emit one identifier per name.
   */
  const extractNames = (node: Parser.SyntaxNode): readonly string[] => {
    const nameNode = node.childForFieldName("name")
    if (nameNode === null) return []
    if (node.type === "variable_declarator") return collectBoundNames(nameNode)
    return [nameNode.text]
  }

  const walk = (node: Parser.SyntaxNode): void => {
    const kind = mapKind[node.type]
    if (kind !== undefined) {
      for (const name of extractNames(node)) {
        identifiers.push({ name, kind, chunkIndex })
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
