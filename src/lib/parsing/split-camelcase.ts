import { tokenize } from "../retrieval/tokenize.js"

/**
 * Split a code identifier into its constituent words.
 *
 * Handles three identifier styles in one pass:
 *
 * - CamelCase / PascalCase: "resolveEmbedderConfig" → ["resolve", "embedder", "config"]
 * - Acronym boundaries: "XMLHttpRequest" → ["xml", "http", "request"]
 * - Snake_case / SCREAMING_SNAKE_CASE: "parse_args" → ["parse", "args"]
 * - Kebab-case: "foo-bar" → ["foo", "bar"]
 *
 * Returns lowercased words. Empty string returns an empty array.
 *
 * Used by the camelCase scoring channel to break indexed identifiers into tokens that user queries
 * can match against.
 */
export const splitCamelCase = (name: string): readonly string[] => {
  // Pre-split acronym boundaries (e.g. "XMLHttp" → "XML Http"), then
  // delegate to the shared tokenize pipeline. The tokenize regex also
  // handles lowercase→uppercase and digit→uppercase boundaries.
  const split = name.replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
  return tokenize(split)
}
