import { NodeContext } from "@effect/platform-node"
import { Effect, Layer } from "effect"
import { expect, test } from "vite-plus/test"

import type { Chunk } from "../domain/chunk.js"
import { DEFAULT_CONFIG } from "../domain/config.js"
import { ConfigStore, Scanner, Chunker, Embedder, VectorStore } from "../domain/ports.js"
import { IndexProject } from "./index-project.js"

test("IndexProject.index stores all chunks with embeddings", () =>
  Effect.gen(function* () {
    let storedChunks: readonly unknown[] = []
    let storedEmbeddings: readonly unknown[] = []

    const mockConfigStore = {
      readConfig: () => Effect.succeed(DEFAULT_CONFIG),
      writeConfig: () => Effect.succeed(undefined),
      configExists: () => Effect.succeed(true),
    }

    const mockScanner = {
      scanFiles: () => Effect.succeed(["/src/a.ts", "/src/b.ts"]),
    }

    const mockChunker = {
      chunkFile: (_file: string) =>
        Effect.succeed([
          { id: "abc", idx: 0, file: "/src/a.ts", startLine: 1, endLine: 10, text: "const a = 1" },
          { id: "def", idx: 1, file: "/src/b.ts", startLine: 5, endLine: 15, text: "const b = 2" },
        ] as const),
    }

    const mockEmbedder = {
      embed: () => Effect.succeed({ vector: new Float32Array(384).fill(0.1), dims: 384 }),
      batch: () =>
        Effect.succeed([
          { vector: new Float32Array(384).fill(0.1), dims: 384 },
          { vector: new Float32Array(384).fill(0.2), dims: 384 },
        ]),
    }

    const mockVectorStore = {
      store: (chunks: readonly unknown[], embeddings: readonly unknown[]) =>
        Effect.sync(() => {
          storedChunks = chunks
          storedEmbeddings = embeddings
        }),
      search: () => Effect.succeed([]),
      getStats: () =>
        Effect.succeed({
          chunks: 2,
          files: 2,
          model: "Xenova/all-MiniLM-L6-v2",
          lastIndex: 0,
          totalLines: 20,
          byteSize: 1024,
        }),
    }

    const mockLayer = Layer.mergeAll(
      Layer.succeed(ConfigStore, mockConfigStore),
      Layer.succeed(Scanner, mockScanner),
      Layer.succeed(Chunker, mockChunker),
      Layer.succeed(Embedder, mockEmbedder),
      Layer.succeed(VectorStore, mockVectorStore),
    )

    const baseLayer = Layer.provideMerge(IndexProject.Default, mockLayer)
    const testLayer = Layer.provideMerge(baseLayer, NodeContext.layer)

    const result = yield* IndexProject.index().pipe(Effect.provide(testLayer))

    expect(result.success).toBe(true)
    expect(result.stats.chunks).toBe(2)
    expect(result.stats.files).toBe(2)
    expect(storedChunks.length).toBe(2)
    expect(storedEmbeddings.length).toBe(2)
  }))

test("IndexProject.index propagates errors from VectorStore", () =>
  Effect.gen(function* () {
    const mockConfigStore = {
      readConfig: () => Effect.succeed(DEFAULT_CONFIG),
      writeConfig: () => Effect.succeed(undefined),
      configExists: () => Effect.succeed(true),
    }

    const mockScanner = {
      scanFiles: () => Effect.succeed(["/src/a.ts"]),
    }

    const mockChunker = {
      chunkFile: () => Effect.succeed([] as readonly Chunk[]),
    }

    const mockEmbedder = {
      embed: () => Effect.succeed({ vector: new Float32Array(384), dims: 384 }),
      batch: () => Effect.succeed([]),
    }

    // Simulate disk full error
    const mockVectorStore = {
      store: () =>
        Effect.fail({
          _tag: "PlatformError",
          reason: "Unknown",
          message: "disk full",
          stack: "",
        } as never),
      search: () => Effect.succeed([]),
      getStats: () =>
        Effect.succeed({
          chunks: 0,
          files: 0,
          model: "",
          lastIndex: 0,
          totalLines: 0,
          byteSize: 0,
        }),
    }

    const mockLayer = Layer.mergeAll(
      Layer.succeed(ConfigStore, mockConfigStore),
      Layer.succeed(Scanner, mockScanner),
      Layer.succeed(Chunker, mockChunker),
      Layer.succeed(Embedder, mockEmbedder),
      Layer.succeed(VectorStore, mockVectorStore),
    )

    const baseLayer = Layer.provideMerge(IndexProject.Default, mockLayer)
    const testLayer = Layer.provideMerge(baseLayer, NodeContext.layer)

    const result = yield* Effect.either(IndexProject.index().pipe(Effect.provide(testLayer)))

    expect(result._tag).toBe("Left")
  }))
