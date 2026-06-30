import { Option } from "effect"
import Parser from "tree-sitter"
import TypeScript from "tree-sitter-typescript"

import { identityProcessor, skipProcessor, type FileProcessor } from "./config/processors.js"

/**
 * Per-extension behavior. Single source of truth for what we do with a file based on its extension:
 * read text via `processor`, and optionally extract identifiers via `parser` (None for extensions
 * we don't have an AST grammar for, or that aren't worth parsing -- text, config, binary).
 */
export interface ExtensionEntry {
  /** Reads file content as text. Fails for unsupported/binary formats. */
  readonly processor: FileProcessor
  /** AST parser for identifier extraction. None = skip parsing. */
  readonly parser: Option.Option<Parser>
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
 * Rust, Go, ...) carry Option.none() until a tree-sitter grammar is installed and a parser is wired
 * in.
 */
const DEFAULT_EXTENSION_REGISTRY: Record<string, ExtensionEntry> = {
  // TypeScript-flavored. tree-sitter-typescript exposes two separate grammars:
  // `typescript` (strict TS, used for .ts and .js) and `tsx` (TS with JSX, for .tsx and .jsx).
  ".ts": { processor: identityProcessor, parser: Option.some(TYPESCRIPT_PARSER) },
  ".tsx": { processor: identityProcessor, parser: Option.some(TSX_PARSER) },
  ".js": { processor: identityProcessor, parser: Option.some(TYPESCRIPT_PARSER) },
  ".jsx": { processor: identityProcessor, parser: Option.some(TSX_PARSER) },
  // Other code -- parser: None until a tree-sitter package is added
  ".py": { processor: identityProcessor, parser: Option.none() },
  ".rs": { processor: identityProcessor, parser: Option.none() },
  ".go": { processor: identityProcessor, parser: Option.none() },
  ".java": { processor: identityProcessor, parser: Option.none() },
  ".c": { processor: identityProcessor, parser: Option.none() },
  ".cpp": { processor: identityProcessor, parser: Option.none() },
  ".h": { processor: identityProcessor, parser: Option.none() },
  ".hpp": { processor: identityProcessor, parser: Option.none() },
  // Config / data -- no AST extraction
  ".json": { processor: identityProcessor, parser: Option.none() },
  ".yaml": { processor: identityProcessor, parser: Option.none() },
  ".yml": { processor: identityProcessor, parser: Option.none() },
  ".toml": { processor: identityProcessor, parser: Option.none() },
  ".xml": { processor: identityProcessor, parser: Option.none() },
  ".csv": { processor: identityProcessor, parser: Option.none() },
  // Docs
  ".md": { processor: identityProcessor, parser: Option.none() },
  ".mdx": { processor: identityProcessor, parser: Option.none() },
  ".txt": { processor: identityProcessor, parser: Option.none() },
  ".rst": { processor: identityProcessor, parser: Option.none() },
  // Web
  ".html": { processor: identityProcessor, parser: Option.none() },
  ".css": { processor: identityProcessor, parser: Option.none() },
  ".scss": { processor: identityProcessor, parser: Option.none() },
  ".less": { processor: identityProcessor, parser: Option.none() },
  ".sql": { processor: identityProcessor, parser: Option.none() },
  ".graphql": { processor: identityProcessor, parser: Option.none() },
  // Shell / scripts
  ".sh": { processor: identityProcessor, parser: Option.none() },
  ".bash": { processor: identityProcessor, parser: Option.none() },
  ".ps1": { processor: identityProcessor, parser: Option.none() },
  ".bat": { processor: identityProcessor, parser: Option.none() },
  ".cmake": { processor: identityProcessor, parser: Option.none() },
  ".dockerfile": { processor: identityProcessor, parser: Option.none() },
  dockerfile: { processor: identityProcessor, parser: Option.none() },
  // Config files (no leading dot)
  makefile: { processor: identityProcessor, parser: Option.none() },
  gemfile: { processor: identityProcessor, parser: Option.none() },
  // Lock files
  ".lock": { processor: identityProcessor, parser: Option.none() },
  lock: { processor: identityProcessor, parser: Option.none() },
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
      parser: Option.none(),
    }
  }
  return registry
}
