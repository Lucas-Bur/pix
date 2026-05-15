import { Effect, Ref, Stream, Option } from "effect"
import * as Chunk from "effect/Chunk"

import { Display } from "../display/Display.js"
import type { Chunk as DomainChunk } from "../domain/chunk.js"
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
import {
  ConfigStore,
  Scanner,
  Chunker,
  Embedder,
  VectorStore,
  ContentExtractor,
  type SkippedEntry,
} from "../domain/ports.js"
import { buildProcessorMap } from "../services/processors/index.js"
import type { StatusResult } from "./get-status.js"

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

interface FileClassification {
  readonly knownFiles: string[]
  readonly skippedFiles: string[]
  readonly unknownExtensions: Set<string>
}

const classifyFiles = (
  files: readonly string[],
  processorMap: Record<string, unknown>,
): FileClassification => {
  const knownFiles: string[] = []
  const skippedFiles: string[] = []
  const unknownExtensions = new Set<string>()

  for (const file of files) {
    const ext = getExtension(file)
    const proc = processorMap[ext]
    if (!proc) {
      unknownExtensions.add(ext)
      skippedFiles.push(file)
    } else {
      knownFiles.push(file)
    }
  }

  return { knownFiles, skippedFiles, unknownExtensions }
}

interface ExtractedFile {
  readonly file: string
  readonly text: string
}

export class IndexProject extends Effect.Service<IndexProject>()("IndexProject", {
  accessors: true,
  effect: Effect.gen(function* () {
    const configStore = yield* ConfigStore
    const scanner = yield* Scanner
    const chunker = yield* Chunker
    const embedder = yield* Embedder
    const vectorStore = yield* VectorStore
    const d = yield* Display
    const extractor = yield* ContentExtractor

    const index = (): Effect.Effect<
      IndexResult,
      | AllConfigErrors
      | ScanFailed
      | ChunkerError
      | AllEmbedderErrors
      | AllProcessorErrors
      | StoreError
      | DiskFullError
    > =>
      Effect.gen(function* () {
        const hasConfig = yield* configStore.configExists()
        if (!hasConfig) {
          yield* configStore.writeConfig(DEFAULT_CONFIG)
        }
        const config = yield* configStore.readConfig()
        const processorMap = buildProcessorMap(config.skipExtensions)
        const batchSize = config.embedder.batchSize ?? 16
        const concurrency = Math.max(1, config.chunkConcurrency ?? 8)

        yield* d.updateInteractive("Scanning source files...")
        const ignoredPaths = config.ignoredPaths ?? DEFAULT_CONFIG.ignoredPaths
        const scanResult = yield* scanner.scanFiles(ignoredPaths)

        const { knownFiles, skippedFiles, unknownExtensions } = classifyFiles(
          scanResult.files,
          processorMap,
        )

        const skipped = yield* Ref.make<readonly SkippedEntry[]>(
          scanResult.skipped.map((s) => ({ path: s.path, reason: s.reason })),
        )

        if (unknownExtensions.size > 0) {
          yield* Ref.update(skipped, (prev) => [
            ...prev,
            ...skippedFiles.map((f) => ({
              path: f,
              reason: "unknown extension",
            })),
          ])
        }

        if (knownFiles.length === 0) {
          const collected = yield* Ref.get(skipped)
          if (collected.length > 0) {
            yield* d.note(
              `Skipped ${collected.length} files:\n${collected.map((s) => `${s.path}: ${s.reason}`).join("\n")}`,
              "Skipped files",
            )
          }
          return {
            success: true as const,
            status: { chunks: 0, files: 0, totalLines: 0, byteSize: 0 },
          }
        }

        yield* d.updateInteractive(`Processing ${knownFiles.length} files...`)

        const embedded = yield* Ref.make(0)

        const pipeline = Stream.fromIterable(knownFiles).pipe(
          Stream.mapEffect(
            (file) =>
              extractor.extract(file).pipe(
                Effect.flatMap((text) =>
                  Effect.succeed<Option.Option<ExtractedFile>>(Option.some({ file, text })),
                ),
                Effect.catchAll((err) =>
                  Ref.update(skipped, (prev) => [
                    ...prev,
                    { path: file, reason: err.message },
                  ]).pipe(
                    Effect.flatMap(() =>
                      Effect.succeed<Option.Option<ExtractedFile>>(Option.none()),
                    ),
                  ),
                ),
              ),
            { concurrency },
          ),
          Stream.filterMap((opt: Option.Option<ExtractedFile>) => opt),
          Stream.mapEffect(({ file, text }) => chunker.chunkText(text, file), { concurrency }),
          Stream.flatMap((chunks) => Stream.fromIterable(chunks)),
          Stream.grouped(batchSize),
          Stream.mapEffect((batchChunk) =>
            Effect.gen(function* () {
              const batch = Chunk.toArray(batchChunk)
              const texts = batch.map((c: DomainChunk) => c.text)
              const embeddings = yield* embedder.batch(texts)
              yield* vectorStore.storeBatch(batch, embeddings)
              yield* Ref.update(embedded, (n) => n + batch.length)
              const count = yield* Ref.get(embedded)
              if (count % 20 === 0) {
                yield* d.updateInteractive(`${count} chunks embedded`)
              }
            }),
          ),
          Stream.runDrain,
        )

        yield* vectorStore.storeBegin()

        const stats = yield* pipeline.pipe(
          Effect.matchEffect({
            onSuccess: () => vectorStore.storeCommit(),
            onFailure: (err) =>
              vectorStore.storeAbort().pipe(Effect.flatMap(() => Effect.fail(err))),
          }),
        )

        const collected = yield* Ref.get(skipped)
        if (collected.length > 0) {
          yield* d.note(
            `Skipped ${collected.length} files:\n${collected.map((s) => `${s.path}: ${s.reason}`).join("\n")}`,
            "Skipped files",
          )
        }

        yield* d.log(`Indexed ${stats.chunks} chunks from ${stats.files} files`, "success")

        return {
          success: true as const,
          status: {
            chunks: stats.chunks,
            files: stats.files,
            totalLines: stats.totalLines,
            byteSize: stats.byteSize,
          },
        }
      })

    return { index }
  }),
}) {}
