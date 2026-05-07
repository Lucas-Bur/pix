import type { PlatformError } from "@effect/platform/Error"
import { Effect, Context } from "effect"

import type { Chunk } from "./chunk.js"
import type { Config, ConfigError } from "./config.js"
import type { Embedding } from "./embedding.js"

// === ConfigStore Port ===

export class ConfigStore extends Context.Tag("ConfigStore")<
  ConfigStore,
  {
    readonly readConfig: () => Effect.Effect<Config, ConfigError>
    readonly writeConfig: (config: Config) => Effect.Effect<void, ConfigError>
    readonly configExists: () => Effect.Effect<boolean>
  }
>() {}

// === Scanner Port ===

export class Scanner extends Context.Tag("Scanner")<
  Scanner,
  {
    readonly scanFiles: (extensions: readonly string[]) => Effect.Effect<string[], never>
  }
>() {}

// === Chunker Port ===

export class Chunker extends Context.Tag("Chunker")<
  Chunker,
  {
    readonly chunkFile: (file: string) => Effect.Effect<readonly Chunk[], never>
  }
>() {}

// === Embedder Port ===

export class Embedder extends Context.Tag("Embedder")<
  Embedder,
  {
    readonly embed: (text: string) => Effect.Effect<Embedding, never>
    readonly batch: (texts: readonly string[]) => Effect.Effect<readonly Embedding[], never>
  }
>() {}

// === VectorStore Port ===

export interface SearchResult {
  readonly score: number
  readonly file: string
  readonly startLine: number
  readonly endLine: number
  readonly text: string
  readonly contextBefore?: string
  readonly contextAfter?: string
}

export class VectorStore extends Context.Tag("VectorStore")<
  VectorStore,
  {
    readonly store: (
      chunks: readonly Chunk[],
      embeddings: readonly Embedding[],
    ) => Effect.Effect<void, PlatformError>
    readonly search: (
      query: Embedding,
      topK: number,
    ) => Effect.Effect<readonly SearchResult[], PlatformError>
    readonly getStats: () => Effect.Effect<
      {
        chunks: number
        files: number
        model: string
        lastIndex: number
        totalLines: number
        byteSize: number
      },
      PlatformError
    >
  }
>() {}
