import Parser from "tree-sitter"
import TypeScript from "tree-sitter-typescript"

import { identityProcessor, skipProcessor, type FileProcessor } from "./config/processors.js"

/**
 * Per-extension behavior. Single source of truth for what we do with a file based on its extension:
 * read text via `processor`, and optionally extract identifiers via `parser` (null for extensions
 * we don't have an AST grammar for, or that aren't worth parsing -- text, config, binary).
 */
export interface ExtensionEntry {
  /** Reads file content as text. Fails for unsupported/binary formats. */
  readonly processor: FileProcessor
  /** AST parser for identifier extraction. null = skip parsing. */
  readonly parser: Parser | null
}

/** Tree-sitter parser pre-configured with the TypeScript grammar (no JSX). For .ts and .js. */
export const TYPESCRIPT_PARSER: Parser = (() => {
  const parser = new Parser()
  parser.setLanguage(TypeScript.typescript)
  return parser
})()

/** Tree-sitter parser pre-configured with the TSX grammar (TypeScript with JSX). For .tsx and .jsx. */
export const TSX_PARSER: Parser = (() => {
  const parser = new Parser()
  parser.setLanguage(TypeScript.tsx)
  return parser
})()

/**
 * Default mapping of file extension -> behavior. Used as the base for `buildExtensionRegistry` and
 * as the single place to add a new language (one entry per file extension, one parser per
 * language).
 *
 * For TypeScript-flavored extensions the parser is pre-configured. Other code extensions (Python,
 * Rust, Go, ...) carry null until a tree-sitter grammar is installed and a parser is wired in.
 */
const DEFAULT_EXTENSION_REGISTRY: Record<string, ExtensionEntry> = {
  // TypeScript-flavored. tree-sitter-typescript exposes two separate grammars:
  // `typescript` (strict TS, used for .ts and .js) and `tsx` (TS with JSX, for .tsx and .jsx).
  ".ts": { processor: identityProcessor, parser: TYPESCRIPT_PARSER },
  ".tsx": { processor: identityProcessor, parser: TSX_PARSER },
  ".js": { processor: identityProcessor, parser: TYPESCRIPT_PARSER },
  ".jsx": { processor: identityProcessor, parser: TSX_PARSER },
  // Other code -- parser: None until a tree-sitter package is added
  ".py": { processor: identityProcessor, parser: null },
  ".rs": { processor: identityProcessor, parser: null },
  ".go": { processor: identityProcessor, parser: null },
  ".java": { processor: identityProcessor, parser: null },
  ".c": { processor: identityProcessor, parser: null },
  ".cpp": { processor: identityProcessor, parser: null },
  ".h": { processor: identityProcessor, parser: null },
  ".hpp": { processor: identityProcessor, parser: null },
  // Config / data -- no AST extraction
  ".json": { processor: identityProcessor, parser: null },
  ".yaml": { processor: identityProcessor, parser: null },
  ".yml": { processor: identityProcessor, parser: null },
  ".toml": { processor: identityProcessor, parser: null },
  ".xml": { processor: identityProcessor, parser: null },
  ".csv": { processor: identityProcessor, parser: null },
  // Docs
  ".md": { processor: identityProcessor, parser: null },
  ".mdx": { processor: identityProcessor, parser: null },
  ".txt": { processor: identityProcessor, parser: null },
  ".rst": { processor: identityProcessor, parser: null },
  // Web
  ".html": { processor: identityProcessor, parser: null },
  ".css": { processor: identityProcessor, parser: null },
  ".scss": { processor: identityProcessor, parser: null },
  ".less": { processor: identityProcessor, parser: null },
  ".sql": { processor: identityProcessor, parser: null },
  ".graphql": { processor: identityProcessor, parser: null },
  // Shell / scripts
  ".sh": { processor: identityProcessor, parser: null },
  ".bash": { processor: identityProcessor, parser: null },
  ".ps1": { processor: identityProcessor, parser: null },
  ".bat": { processor: identityProcessor, parser: null },
  ".cmake": { processor: identityProcessor, parser: null },
  ".dockerfile": { processor: identityProcessor, parser: null },
  dockerfile: { processor: identityProcessor, parser: null },
  // Config files (no leading dot)
  makefile: { processor: identityProcessor, parser: null },
  gemfile: { processor: identityProcessor, parser: null },
  // Lock files
  ".lock": { processor: identityProcessor, parser: null },
  lock: { processor: identityProcessor, parser: null },
}

/**
 * Builds a per-run registry by merging the default mapping with user-specified skip extensions.
 * Skip extensions override any existing entry -- both the processor becomes a skip-failure and the
 * parser is cleared, so neither text extraction nor identifier extraction runs.
 */
export const buildExtensionRegistry = (
  skipExtensions: readonly string[],
): Record<string, ExtensionEntry> => {
  const registry: Record<string, ExtensionEntry> = { ...DEFAULT_EXTENSION_REGISTRY }
  for (const ext of skipExtensions) {
    registry[ext] = {
      processor: skipProcessor(ext),
      parser: null,
    }
  }
  return registry
}
