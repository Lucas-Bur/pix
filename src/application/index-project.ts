import { FileSystem } from "@effect/platform"
import { Effect } from "effect"

import { Display } from "../display/Display.js"
import { DEFAULT_CONFIG } from "../domain/config.js"
import type {
  AllConfigErrors,
  AllEmbedderErrors,
  AllProcessorErrors,
  ChunkerError,
  DiskFullError,
  ScanFailed,
  StoreError,
} from "../domain/errors.js"
import { ConfigStore, Scanner, Chunker, Embedder, VectorStore } from "../domain/ports.js"
import { buildProcessorMap } from "../services/processors/index.js"
import type { StatusResult } from "./get-status.js"

/** Result of indexing a project. */
interface IndexResult {
  readonly success: true
  readonly status: Omit<StatusResult, "model" | "lastIndex">
}

function getExtension(file: string): string {
  const lastSlash = file.lastIndexOf("/")
  const name = lastSlash >= 0 ? file.slice(lastSlash + 1) : file
  const dotIndex = name.lastIndexOf(".")
  if (dotIndex === -1) return name.toLowerCase()
  return name.slice(dotIndex).toLowerCase()
}

/**
 * Use case: index project files. Pipeline: scan → ContentExtractor → chunk → embed → store. Depends
 * on ConfigStore, Scanner, Chunker, Embedder, VectorStore, Display via Effect tags.
 */
export class IndexProject extends Effect.Service<IndexProject>()("IndexProject", {
  accessors: true,
  effect: Effect.gen(function* () {
    const configStore = yield* ConfigStore
    const scanner = yield* Scanner
    const chunker = yield* Chunker
    const embedder = yield* Embedder
    const vectorStore = yield* VectorStore
    const d = yield* Display

    const index = (): Effect.Effect<
      IndexResult,
      | AllConfigErrors
      | ScanFailed
      | ChunkerError
      | AllEmbedderErrors
      | AllProcessorErrors
      | StoreError
      | DiskFullError,
      FileSystem.FileSystem
    > =>
      Effect.gen(function* () {
        const hasConfig = yield* configStore.configExists()
        if (!hasConfig) {
          yield* configStore.writeConfig(DEFAULT_CONFIG)
        }
        const config = yield* configStore.readConfig()
        const processorMap = buildProcessorMap(config.skipExtensions)

        yield* d.updateInteractive("Scanning source files...")
        const ignoredPaths = config.ignoredPaths ?? DEFAULT_CONFIG.ignoredPaths
        const scanResult = yield* scanner.scanFiles(ignoredPaths)

        const unknownExtensions = new Set<string>()
        const skippedFiles: string[] = []

        const knownFiles = scanResult.files.filter((file) => {
          const ext = getExtension(file)
          const proc = processorMap[ext]
          if (!proc) {
            unknownExtensions.add(ext)
            skippedFiles.push(file)
            return false
          }
          return true
        })

        if (unknownExtensions.size > 0) {
          yield* d.log(
            `Skipped ${skippedFiles.length} files with unknown extensions: ${[...unknownExtensions].join(", ")}`,
            "warn",
          )
        }

        if (knownFiles.length === 0) {
          return {
            success: true as const,
            status: { chunks: 0, files: 0, totalLines: 0, byteSize: 0 },
          }
        }

        yield* d.updateInteractive(`Processing ${knownFiles.length} files...`)
        const fileChunkArrays = yield* Effect.forEach(
          knownFiles,
          (file) =>
            Effect.gen(function* () {
              const ext = getExtension(file)
              const processor = processorMap[ext]
              const result = yield* Effect.either(processor(file))
              if (result._tag === "Left") {
                yield* d.log(`Skipping ${file}: ${result.left.message}`, "warn")
                return []
              }
              return yield* chunker.chunkText(result.right, file)
            }),
          { concurrency: Math.max(1, config.chunkConcurrency ?? 8) },
        )

        const allChunks = fileChunkArrays.flat()
        const totalChunks = allChunks.length
        const uniqueFiles = new Set(allChunks.map((c) => c.file))
        const totalFiles = uniqueFiles.size
        const totalLines = allChunks.reduce((sum, c) => sum + (c.endLine - c.startLine + 1), 0)

        if (totalChunks === 0) {
          return {
            success: true as const,
            status: { chunks: 0, files: 0, totalLines: 0, byteSize: 0 },
          }
        }

        yield* d.updateInteractive(`Embedding ${totalChunks} chunks...`)
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
