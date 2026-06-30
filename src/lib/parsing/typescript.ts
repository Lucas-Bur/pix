// Tree-sitter language parsers used by the identifier extractor.
// Each parser is a separate npm package. The full list is at:
// https://github.com/tree-sitter/tree-sitter/wiki/List-of-parsers
//
// To enable a new language:
//   1. vp add tree-sitter-<lang>
//   2. Add a new file in this directory exporting <lang>MapKind
//   3. Wire it into the registry under the language's file extensions
//
// Tree-sitter node types are grammar-specific (e.g. TypeScript uses
// `function_declaration`, Python uses `function_definition`, Rust uses
// `function_item`). The mapKind table per language bridges this to our
// 3-category vocabulary: "function" | "type" | "value".

import type { IdentifierKind } from "../../domain/identifier.js"

/**
 * Maps tree-sitter node types from the TypeScript grammar to the language-agnostic IdentifierKind
 * vocabulary.
 *
 * Only the OUTERMOST node that carries a `name` field is mapped. Inner expression nodes
 * (arrow_function, function_expression) are intentionally absent — they have no name and are
 * captured indirectly via the surrounding variable_declarator when assigned to a const/let/var.
 */
export const typescriptMapKind: Record<string, IdentifierKind> = {
  // functions
  function_declaration: "function",
  generator_function_declaration: "function",
  method_definition: "function",
  // types
  class_declaration: "type",
  abstract_class_declaration: "type",
  interface_declaration: "type",
  type_alias_declaration: "type",
  enum_declaration: "type",
  // values
  variable_declarator: "value",
}
