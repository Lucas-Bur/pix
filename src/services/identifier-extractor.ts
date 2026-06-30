import { Effect, Layer } from "effect"
import Parser from "tree-sitter"
import TypeScript from "tree-sitter-typescript"

import type { Identifier } from "../domain/identifier.js"
import { IdentifierExtractor } from "../domain/ports.js"
import { extractIdentifiers as extractIdentifiersPure } from "../lib/parsing/identifier-extractor.js"
import { typescriptMapKind } from "../lib/parsing/typescript.js"

/**
 * FileSystem-independent adapter for the IdentifierExtractor port.
 *
 * The tree-sitter parser is pre-configured at layer construction with the TypeScript grammar
 * (strict, no JSX). The TSX grammar is wired in via the extension registry -- callers that want
 * JSX-aware parsing should look up the registry entry for `.tsx`/`.jsx` and use a separate service
 * instance. For MVP we ship a single service that handles TypeScript files; per-extension parsers
 * (TSX) and additional languages (Python, Rust, Go, ...) are added by extending this service or by
 * introducing per-language service variants.
 */
const make = () => {
  const parser = new Parser()
  parser.setLanguage(TypeScript.typescript)

  return {
    extractIdentifiers: (
      text: string,
      chunkIndex: number,
    ): Effect.Effect<readonly Identifier[], never> =>
      Effect.succeed(extractIdentifiersPure(parser, typescriptMapKind, text, chunkIndex)),
  } as const
}

/** Live layer for IdentifierExtractor. No external dependencies. */
export const IdentifierExtractorLive = Layer.succeed(IdentifierExtractor, make())
