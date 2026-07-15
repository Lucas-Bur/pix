import type { IdentifierKind } from "../../domain/identifier.js"

/** Maps Rust tree-sitter declaration nodes to language-agnostic identifier kinds. */
export const rustMapKind: Record<string, IdentifierKind> = {
  function_item: "function",
  function_signature_item: "function",
  struct_item: "type",
  enum_item: "type",
  union_item: "type",
  trait_item: "type",
  type_item: "type",
  const_item: "value",
  static_item: "value",
}
