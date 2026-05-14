import { Effect } from "effect"

import type {
  AllConfigErrors,
  AllEmbedderErrors,
  AllStoreErrors,
  ChunkerError,
  ScanFailed,
} from "../domain/errors.js"
import { ConfigStore, Scanner, Chunker, Embedder, VectorStore } from "../domain/ports.js"
import type { StatusResult } from "./get-status.js"

/** Result of indexing a project. */
interface IndexResult {
  readonly success: true
  readonly status: Omit<StatusResult, "model" | "lastIndex">
}

/**
 * Use case: index project files. Pipeline: scan → chunk → embed → store. Depends on ConfigStore,
 * Scanner, Chunker, Embedder, VectorStore via Effect tags.
 */
export class IndexProject extends Effect.Service<IndexProject>()("IndexProject", {
  accessors: true,
  effect: Effect.gen(function* () {
    const configStore = yield* ConfigStore
    const scanner = yield* Scanner
    const chunker = yield* Chunker
    const embedder = yield* Embedder
    const vectorStore = yield* VectorStore

    const index = (): Effect.Effect<
      IndexResult,
      AllConfigErrors | ScanFailed | ChunkerError | AllEmbedderErrors | AllStoreErrors
    > =>
      Effect.gen(function* () {
        const config = yield* configStore.readConfig()
        const extensions =
          Object.keys(config.files).length > 0
            ? Object.keys(config.files)
            : [".ts", ".tsx", ".js", ".jsx"]

        const scanResult = yield* scanner.scanFiles(extensions)

        const fileChunkArrays = yield* Effect.forEach(
          scanResult.files,
          (file) => chunker.chunkFile(file),
          { concurrency: "unbounded" },
        )

        const allChunks = fileChunkArrays.flat()
        const totalChunks = allChunks.length
        const uniqueFiles = new Set(allChunks.map((c) => c.file))
        const totalFiles = uniqueFiles.size
        const totalLines = allChunks.reduce((sum, c) => sum + (c.endLine - c.startLine + 1), 0)

        if (totalChunks === 0) {
          yield* Effect.logInfo("No chunks to index.")
          return {
            success: true as const,
            status: { chunks: 0, files: 0, totalLines: 0, byteSize: 0 },
          }
        }

        const texts = allChunks.map((c) => c.text)
        const embeddings = yield* embedder.batch(texts)

        yield* vectorStore.store(allChunks, embeddings)

        const dims = embeddings[0]?.dims ?? 384
        const byteSize = embeddings.length * dims * 4

        return {
          success: true as const,
          status: { chunks: totalChunks, files: totalFiles, totalLines, byteSize },
        }
      })

    return { index }
  }),
}) {}
