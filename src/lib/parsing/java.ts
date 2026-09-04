import type { IdentifierKind } from "../../domain/identifier.js"

/** Maps Java tree-sitter declaration nodes to language-agnostic identifier kinds. */
export const javaMapKind: Record<string, IdentifierKind> = {
  method_declaration: "function",
  constructor_declaration: "function",
  class_declaration: "type",
  interface_declaration: "type",
  enum_declaration: "type",
  record_declaration: "type",
  annotation_type_declaration: "type",
  variable_declarator: "value",
  enum_constant: "value",
}
