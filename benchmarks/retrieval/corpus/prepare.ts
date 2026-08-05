import { readFile } from "node:fs/promises"
import path from "node:path"

import { Effect } from "effect"

import type { Chunk } from "../../../src/domain/chunk.js"
import { DEFAULT_CONFIG } from "../../../src/domain/config.js"
import type { Identifier } from "../../../src/domain/identifier.js"
import type { Bm25Index } from "../../../src/domain/ports.js"
import { getExtension } from "../../../src/lib/config/extension.js"
import { extractIdentifiers } from "../../../src/lib/parsing/identifier-extractor.js"
import { buildExtensionRegistry } from "../../../src/lib/registry.js"
import { buildBm25Index } from "../../../src/lib/retrieval/bm25.js"
import { buildIdentifierIndex } from "../../../src/lib/retrieval/identifier-index.js"
import { chunkTextWithRegistry } from "../../../src/services/chunker.js"
import type { ChunkIdentifiers } from "../evaluation/metrics.js"
import type { CorpusManifest } from "../evaluation/types.js"
import { listCorpusFiles } from "./repository.js"

/** Query-independent indexes and source chunks prepared once per repository. */
export interface PreparedCorpus {
  readonly chunks: readonly Chunk[]
  readonly bm25Index: Bm25Index
  readonly identifierIndex: ReturnType<typeof buildIdentifierIndex>
  readonly identifiersByChunk: ChunkIdentifiers
  readonly preparationDurationMs: number
}

/** Prepare real pix chunks and lexical indexes from one pinned repository checkout. */
export const prepareCorpus = (
  repositoryPath: string,
  manifest: CorpusManifest,
): Effect.Effect<PreparedCorpus, Error> =>
  Effect.gen(function* () {
    const startedAt = performance.now()
    const registry = buildExtensionRegistry(DEFAULT_CONFIG.skipExtensions)
    const files = yield* listCorpusFiles(repositoryPath, manifest)
    const chunksByFile = yield* Effect.forEach(
      files,
      (file) =>
        Effect.tryPromise({
          try: () => readFile(path.join(repositoryPath, ...file.split("/")), "utf8"),
          catch: (cause) => new Error(`Could not read benchmark source ${file}`, { cause }),
        }).pipe(Effect.flatMap((text) => chunkTextWithRegistry(text, file, registry))),
      { concurrency: DEFAULT_CONFIG.chunkConcurrency },
    )
    const chunks = chunksByFile.flat()
    const identifiers: Identifier[] = []
    const identifiersByChunk = new Map<number, ReadonlySet<string>>()

    for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
      const chunk = chunks[chunkIndex]
      const entry = registry[getExtension(chunk.file)]
      const parser = entry?.parser
      const mapKind = entry?.mapKind
      const extracted =
        parser && mapKind
          ? yield* Effect.try({
              try: () => extractIdentifiers(parser, mapKind, chunk.text, chunkIndex),
              catch: (cause) =>
                new Error(
                  `Identifier extraction failed for ${chunk.file}:${chunk.startLine}-${chunk.endLine}`,
                  { cause },
                ),
            })
          : []
      identifiers.push(...extracted)
      identifiersByChunk.set(
        chunkIndex,
        new Set(extracted.map((identifier) => identifier.name.toLowerCase())),
      )
    }

    return {
      chunks,
      bm25Index: buildBm25Index(chunks.map((chunk, index) => ({ index, text: chunk.text }))),
      identifierIndex: buildIdentifierIndex(identifiers),
      identifiersByChunk,
      preparationDurationMs: performance.now() - startedAt,
    }
  })
