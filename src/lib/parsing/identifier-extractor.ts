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

  const collectBoundNames = (node: Parser.SyntaxNode, names: string[]): void => {
    switch (node.type) {
      case "identifier":
      case "shorthand_property_identifier_pattern":
        names.push(node.text)
        return
      case "object_pattern":
      case "array_pattern":
      case "rest_pattern":
        for (let i = 0; i < node.namedChildCount; i++) {
          const child = node.namedChild(i)
          if (child !== null) collectBoundNames(child, names)
        }
        return
      case "pair_pattern":
      case "pair":
        // { key: value } -- the binding is the value, not the key
        {
          const value = node.childForFieldName("value")
          if (value !== null) collectBoundNames(value, names)
        }
        return
      case "assignment_pattern":
        // { x = 1 } -- the binding is the left side, default lives on the right
        {
          const left = node.childForFieldName("left")
          if (left !== null) collectBoundNames(left, names)
        }
        return
      default:
        names.push(node.text)
    }
  }

  const walk = (node: Parser.SyntaxNode): void => {
    const kind = mapKind[node.type]
    if (kind !== undefined) {
      if (node.type === "variable_declarator") {
        const nameNode = node.childForFieldName("name")
        if (nameNode !== null) {
          const names: string[] = []
          collectBoundNames(nameNode, names)
          for (const name of names) {
            identifiers.push({ name, kind, chunkIndex })
          }
        }
      } else {
        const nameNode = node.childForFieldName("name")
        if (nameNode !== null) {
          identifiers.push({ name: nameNode.text, kind, chunkIndex })
        }
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
