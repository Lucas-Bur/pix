import { Effect, Layer } from "effect"
import Parser from "tree-sitter"
import TypeScript from "tree-sitter-typescript"

import type { Identifier } from "../domain/identifier.js"
import { IdentifierExtractor } from "../domain/ports.js"
import { getExtension } from "../lib/config/extension.js"
import { extractIdentifiers as extractIdentifiersPure } from "../lib/parsing/identifier-extractor.js"
import { typescriptMapKind } from "../lib/parsing/typescript.js"

/**
 * FileSystem-independent adapter for the IdentifierExtractor port.
 *
 * The tree-sitter parser is pre-configured at layer construction with the TypeScript grammar
 * (strict, no JSX). The TSX grammar is wired in for `.tsx`/`.jsx` files. Other code extensions
 * (Python, Rust, Go, ...) return empty for now; they're added by extending the dispatch table.
 *
 * Dispatch is by file extension. For a chunk from an unknown extension (text, config, binary) the
 * service returns [] -- the caller is expected to have classified the file via the extension
 * registry upstream, but the service is defensive in case it isn't.
 */
const make = () => {
  const typescriptParser = new Parser()
  typescriptParser.setLanguage(TypeScript.typescript)
  const tsxParser = new Parser()
  tsxParser.setLanguage(TypeScript.tsx)

  // Pre-configured parsers indexed by file extension. tree-sitter-typescript
  // contains both the strict-TS and TS-with-JSX grammars in one package.
  const parsersByExt: Readonly<Record<string, Parser>> = {
    ".ts": typescriptParser,
    ".tsx": tsxParser,
    ".js": typescriptParser,
    ".jsx": tsxParser,
  }

  return {
    extractIdentifiers: (file: string, text: string, chunkIndex: number) => {
      const ext = getExtension(file)
      const parser = parsersByExt[ext]
      if (parser === undefined) return Effect.succeed<readonly Identifier[]>([])
      return Effect.succeed(extractIdentifiersPure(parser, typescriptMapKind, text, chunkIndex))
    },
  } as const
}

/** Live layer for IdentifierExtractor. No external dependencies. */
export const IdentifierExtractorLive = Layer.succeed(IdentifierExtractor, make())
