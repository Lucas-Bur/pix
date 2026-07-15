import { Effect, Layer } from "effect"

import type { Identifier } from "../domain/identifier.js"
import { IdentifierExtractor } from "../domain/ports.js"
import { getExtension } from "../lib/config/extension.js"
import { extractIdentifiers as extractIdentifiersPure } from "../lib/parsing/identifier-extractor.js"
import { buildExtensionRegistry } from "../lib/registry.js"

/**
 * FileSystem-independent adapter for the IdentifierExtractor port.
 *
 * Tree-sitter parsers and grammar-specific kind maps are pre-configured in the extension registry
 * and dispatched here by file extension. Extensions without both return an empty result.
 *
 * For a chunk from an unknown extension (text, config, binary) the service returns [] -- the caller
 * is expected to have classified the file via the extension registry upstream, but the service is
 * defensive in case it isn't.
 */
const make = () => {
  const registry = buildExtensionRegistry([])

  return {
    extractIdentifiers: (file: string, text: string, chunkIndex: number) => {
      const ext = getExtension(file)
      const entry = registry[ext]
      if (entry === undefined || entry.parser === null || entry.mapKind === undefined) {
        return Effect.succeed<readonly Identifier[]>([])
      }
      return Effect.succeed(extractIdentifiersPure(entry.parser, entry.mapKind, text, chunkIndex))
    },
  } as const
}

/** Live layer for IdentifierExtractor. No external dependencies. */
export const IdentifierExtractorLive = Layer.succeed(IdentifierExtractor, make())
