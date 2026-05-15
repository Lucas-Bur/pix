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
  readonly durationMs: number
}

interface IndexOptions {
  readonly batchSize?: number
  readonly chunkConcurrency?: number
  readonly skipExtensions?: readonly string[]
  readonly ignorePaths?: readonly string[]
  readonly ignoreGitignore?: boolean
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

    const index = (
      opts: IndexOptions = {},
    ): Effect.Effect<
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
        const start = Date.now()

        const hasConfig = yield* configStore.configExists()
        if (!hasConfig) {
          yield* configStore.writeConfig(DEFAULT_CONFIG)
        }
        const config = yield* configStore.readConfig()

        const batchSize = opts.batchSize ?? config.embedder.batchSize ?? 16
        const concurrency = Math.max(1, opts.chunkConcurrency ?? config.chunkConcurrency ?? 8)
        const skipExtensions = opts.skipExtensions
          ? [...config.skipExtensions, ...opts.skipExtensions]
          : config.skipExtensions
        const ignoredPaths = opts.ignorePaths
          ? [...(config.ignoredPaths ?? DEFAULT_CONFIG.ignoredPaths), ...opts.ignorePaths]
          : (config.ignoredPaths ?? DEFAULT_CONFIG.ignoredPaths)
        const ignoreGitignore = opts.ignoreGitignore ?? config.ignoreGitignore ?? false

        const processorMap = buildProcessorMap(skipExtensions)

        yield* d.updateInteractive("Scanning source files...")
        const scanResult = yield* scanner.scanFiles(ignoredPaths, ignoreGitignore)

        const { knownFiles, skippedFiles, unknownExtensions } = classifyFiles(
          scanResult.files,
          processorMap,
        )

        const skipped = yield* Ref.make<readonly SkippedEntry[]>(
          scanResult.skipped
            .filter((s) => !s.reason.startsWith("Ignored by config pattern"))
            .map((s) => ({ path: s.path, reason: s.reason })),
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
          yield* displaySkippedNote(d, collected)

          return {
            success: true as const,
            status: { chunks: 0, files: 0, totalLines: 0, byteSize: 0 },
            durationMs: Date.now() - start,
          }
        }

        yield* d.updateInteractive(`Processing ${knownFiles.length} files...`)

        const embedded = yield* Ref.make(0)
        const chunksProduced = yield* Ref.make(0)
        const totalChunks = yield* Ref.make<Option.Option<number>>(Option.none())

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
          Stream.tap(() => Ref.update(chunksProduced, (n) => n + 1)),
          Stream.buffer({ capacity: 5000 }),
          Stream.grouped(batchSize),
          Stream.mapEffect((batchChunk) =>
            Effect.gen(function* () {
              const batch = Chunk.toArray(batchChunk)
              const texts = batch.map((c: DomainChunk) => c.text)
              const embeddings = yield* embedder.batch(texts)
              yield* vectorStore.storeBatch(batch, embeddings)
              yield* Ref.update(embedded, (n) => n + batch.length)
              const count = yield* Ref.get(embedded)
              const produced = yield* Ref.get(chunksProduced)

              if (Option.isNone(yield* Ref.get(totalChunks)) && produced === count && count > 0) {
                yield* Ref.set(totalChunks, Option.some(count))
                yield* d.updateInteractive({
                  message: `${count} of ${count} chunks embedded`,
                  setMax: count,
                  setTo: count,
                })
              } else {
                const maybeTotal = yield* Ref.get(totalChunks)
                if (Option.isSome(maybeTotal)) {
                  yield* d.updateInteractive({
                    message: `${count} of ${maybeTotal.value} chunks embedded`,
                    setToPercent: Math.round((count / maybeTotal.value) * 100),
                  })
                } else {
                  yield* d.updateInteractive(`${count} chunks embedded`)
                }
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
        yield* displaySkippedNote(d, collected)

        const durationSec = ((Date.now() - start) / 1000).toFixed(1)
        yield* d.log(
          `Indexed ${stats.chunks} chunks from ${stats.files} files in ${durationSec}s`,
          "success",
        )

        return {
          success: true as const,
          status: {
            chunks: stats.chunks,
            files: stats.files,
            totalLines: stats.totalLines,
            byteSize: stats.byteSize,
          },
          durationMs: Date.now() - start,
        }
      })

    return { index }
  }),
}) {}

const displaySkippedNote = (
  d: typeof Display.Service,
  skipped: readonly SkippedEntry[],
): Effect.Effect<void> => {
  if (skipped.length === 0) return Effect.void

  const extFailures = skipped.filter((s) => s.reason === "unknown extension")
  const extractErrors = skipped.filter((s) => s.reason !== "unknown extension")
  const lines: string[] = []

  if (extFailures.length > 0) {
    const byExt = new Map<string, string[]>()
    for (const s of extFailures) {
      const name = s.path.split("/").pop() ?? s.path
      const dotIndex = name.lastIndexOf(".")
      const ext = dotIndex >= 0 ? name.slice(dotIndex) : "(no extension)"
      if (!byExt.has(ext)) byExt.set(ext, [])
      byExt.get(ext)!.push(name)
    }

    lines.push(`Unknown extensions (${extFailures.length})`)
    for (const [ext, files] of byExt) {
      const display =
        files.length > 5
          ? `${files.slice(0, 5).join(", ")} +${files.length - 5} more`
          : files.join(", ")
      lines.push(`  ${ext} (${files.length}): ${display}`)
    }
  }

  if (extractErrors.length > 0) {
    if (lines.length > 0) lines.push("")
    lines.push(`Extraction errors (${extractErrors.length})`)
    for (const s of extractErrors) {
      const name = s.path.split("/").pop() ?? s.path
      lines.push(`  ${name}: ${s.reason}`)
    }
  }

  return d.note(lines.join("\n"), `Skipped ${skipped.length} files`)
}
