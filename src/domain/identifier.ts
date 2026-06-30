/**
 * A symbol extracted from source code at index time.
 *
 * `kind` is intentionally language-agnostic: each language's tree-sitter grammar maps its own
 * construct types (function_declaration, def, fn, class_definition, struct_item, ...) onto one of
 * these three categories. The scorers do not currently differentiate by kind — it is captured for
 * future use cases (e.g. "find where this is imported", "find class definitions only") and for
 * filterability in search results.
 */
export type IdentifierKind = "function" | "type" | "value"

export interface Identifier {
  /** Exact name as it appears in source: "resolveEmbedderConfig", "parse_args", "Vec" */
  readonly name: string
  /** Language-agnostic category. */
  readonly kind: IdentifierKind
  /** Which chunk this identifier was extracted from. */
  readonly chunkIndex: number
}
