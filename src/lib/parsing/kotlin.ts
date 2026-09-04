import type { IdentifierKind } from "../../domain/identifier.js"

/**
 * Maps Kotlin tree-sitter declaration nodes to language-agnostic identifier kinds.
 *
 * Kotlin's grammar has no separate node type for interfaces or enum classes -- `class`,
 * `interface`, and `enum class` all parse as `class_declaration`, distinguished only by a child
 * keyword token. Since all three map to "type" anyway, this collapse is harmless here.
 */
export const kotlinMapKind: Record<string, IdentifierKind> = {
  function_declaration: "function",
  class_declaration: "type",
  object_declaration: "type",
  property_declaration: "value",
  enum_entry: "value",
}
