import Parser from "tree-sitter"

import type { Identifier, IdentifierKind } from "../../domain/identifier.js"
import { parseTreeSitterSource } from "./tree-sitter.js"

const BINDING_NAME_NODE_TYPES = new Set(["identifier", "shorthand_property_identifier_pattern"])

const BINDING_CONTAINER_NODE_TYPES = new Set([
  "object_pattern",
  "array_pattern",
  "rest_pattern",
  "pattern_list",
  "list_pattern",
  "tuple_pattern",
  "list_splat_pattern",
  "dictionary_splat_pattern",
  "multi_variable_declaration",
])

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
  const tree = parseTreeSitterSource(parser, text)
  const identifiers: Identifier[] = []

  /**
   * Recursively collect names bound by TypeScript or Python destructuring patterns. Mutation
   * targets such as Python attributes and subscripts return an empty array because they introduce
   * no name.
   */
  const collectBoundNames = (node: Parser.SyntaxNode): readonly string[] => {
    if (BINDING_NAME_NODE_TYPES.has(node.type)) return [node.text]
    if (BINDING_CONTAINER_NODE_TYPES.has(node.type)) {
      return node.namedChildren.flatMap((child) => (child === null ? [] : collectBoundNames(child)))
    }

    switch (node.type) {
      case "pair_pattern":
      case "pair": {
        const value = node.childForFieldName("value")
        return value === null ? [] : collectBoundNames(value)
      }
      case "assignment_pattern": {
        const left = node.childForFieldName("left")
        return left === null ? [] : collectBoundNames(left)
      }
      case "variable_declaration": {
        const first = node.namedChild(0)
        return first === null ? [] : collectBoundNames(first)
      }
      default:
        return []
    }
  }

  /**
   * Extract the bound names for a matched node. Most declarations use `name`; TypeScript variable
   * declarators may destructure through `name`, Python assignments bind through `left`, the Python
   * grammar exposes a type alias name as its first named child, and Kotlin's `property_declaration`
   * / `enum_entry` carry no `name` field at all -- the bound name sits in their first named child
   * (`variable_declaration`, possibly a `multi_variable_declaration` destructuring pattern, or a
   * plain `identifier`).
   */
  const extractNames = (node: Parser.SyntaxNode): readonly string[] => {
    if (node.type === "assignment") {
      const leftNode = node.childForFieldName("left")
      return leftNode === null ? [] : collectBoundNames(leftNode)
    }
    if (node.type === "type_alias_statement") {
      const aliasNode = node.namedChild(0)
      return aliasNode === null ? [] : [aliasNode.text]
    }
    if (node.type === "property_declaration" || node.type === "enum_entry") {
      const first = node.namedChild(0)
      return first === null ? [] : collectBoundNames(first)
    }
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
