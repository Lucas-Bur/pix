import { Effect, Layer } from "effect"

import type { Identifier } from "../domain/identifier.js"
import { IdentifierExtractor } from "../domain/ports.js"
import { getExtension } from "../lib/config/extension.js"
import { extractIdentifiers as extractIdentifiersPure } from "../lib/parsing/identifier-extractor.js"
import { typescriptMapKind } from "../lib/parsing/typescript.js"
import { TYPESCRIPT_PARSER, TSX_PARSER } from "../lib/registry.js"

/**
 * FileSystem-independent adapter for the IdentifierExtractor port.
 *
 * The tree-sitter parsers are pre-configured in the extension registry (single source of truth --
 * see TYPESCRIPT_PARSER / TSX_PARSER in `src/lib/registry.ts`) and dispatched here by file
 * extension. Other code extensions (Python, Rust, Go, ...) return empty for now; they're added by
 * extending the dispatch table.
 *
 * For a chunk from an unknown extension (text, config, binary) the service returns [] -- the caller
 * is expected to have classified the file via the extension registry upstream, but the service is
 * defensive in case it isn't.
 */
const make = () => {
  // Pre-configured parsers indexed by file extension. tree-sitter-typescript
  // contains both the strict-TS and TS-with-JSX grammars in one package.
  const parsersByExt: Readonly<Record<string, typeof TYPESCRIPT_PARSER>> = {
    ".ts": TYPESCRIPT_PARSER,
    ".tsx": TSX_PARSER,
    ".js": TYPESCRIPT_PARSER,
    ".jsx": TSX_PARSER,
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
