import type { IdentifierKind } from "../../domain/identifier.js"

/** Maps Python tree-sitter declaration nodes to language-agnostic identifier kinds. */
export const pythonMapKind: Record<string, IdentifierKind> = {
  function_definition: "function",
  class_definition: "type",
  type_alias_statement: "type",
  assignment: "value",
}
