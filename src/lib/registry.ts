import Parser from "tree-sitter"
import Python from "tree-sitter-python"
import Rust from "tree-sitter-rust"
import TypeScript from "tree-sitter-typescript"

import type { IdentifierKind } from "../domain/identifier.js"
import { identityProcessor, skipProcessor, type FileProcessor } from "./config/processors.js"
import { pythonMapKind } from "./parsing/python.js"
import { rustMapKind } from "./parsing/rust.js"
import { typescriptMapKind } from "./parsing/typescript.js"

/**
 * Per-extension behavior. Single source of truth for what we do with a file based on its extension:
 * read text via `processor`, and optionally parse its AST for chunking and identifier extraction
 * (null for extensions without a grammar, or that aren't worth parsing -- text, config, binary).
 */
export interface ExtensionEntry {
  /** Reads file content as text. Fails for unsupported/binary formats. */
  readonly processor: FileProcessor
  /** AST parser for chunking and identifier extraction. null = use line chunking. */
  readonly parser: Parser | null
  /** Grammar-specific declaration nodes used for identifier extraction. */
  readonly mapKind?: Record<string, IdentifierKind>
}

const createParser = (language: NonNullable<Parameters<Parser["setLanguage"]>[0]>): Parser => {
  const parser = new Parser()
  parser.setLanguage(language)
  return parser
}

/** Tree-sitter parser pre-configured with the TypeScript grammar (no JSX). For .ts and .js. */
const TYPESCRIPT_PARSER = createParser(TypeScript.typescript)

/** Tree-sitter parser pre-configured with the TSX grammar (TypeScript with JSX). For .tsx and .jsx. */
const TSX_PARSER = createParser(TypeScript.tsx)

/** Tree-sitter parser pre-configured with the Python grammar. */
const PYTHON_PARSER = createParser(Python)

/** Tree-sitter parser pre-configured with the Rust grammar. */
const RUST_PARSER = createParser(Rust)

/**
 * Default mapping of file extension -> behavior. Used as the base for `buildExtensionRegistry` and
 * as the single place to add a new language (one entry per file extension, one parser per
 * language).
 *
 * TypeScript, Python, and Rust extensions have pre-configured parsers. Other code extensions carry
 * null until a tree-sitter grammar is installed and wired in.
 */
const DEFAULT_EXTENSION_REGISTRY: Record<string, ExtensionEntry> = {
  // TypeScript-flavored. tree-sitter-typescript exposes two separate grammars:
  // `typescript` (strict TS, used for .ts and .js) and `tsx` (TS with JSX, for .tsx and .jsx).
  ".ts": { processor: identityProcessor, parser: TYPESCRIPT_PARSER, mapKind: typescriptMapKind },
  ".tsx": { processor: identityProcessor, parser: TSX_PARSER, mapKind: typescriptMapKind },
  ".js": { processor: identityProcessor, parser: TYPESCRIPT_PARSER, mapKind: typescriptMapKind },
  ".jsx": { processor: identityProcessor, parser: TSX_PARSER, mapKind: typescriptMapKind },
  ".py": { processor: identityProcessor, parser: PYTHON_PARSER, mapKind: pythonMapKind },
  ".rs": { processor: identityProcessor, parser: RUST_PARSER, mapKind: rustMapKind },
  // Other code -- parser: null until a tree-sitter package is added
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
