import { Effect, Context } from "effect"

import type { Chunk } from "./chunk.js"
import type { Config, ConfigError } from "./config.js"
import type { Embedding } from "./embedding.js"
import type {
  ConfigMalformedError,
  ConfigNotFoundError,
  DiskFullError,
  NoIndexError,
  StoreError,
  ChunkerError,
  ModelLoadError,
  InferenceError,
  ScanFailed,
  AllProcessorErrors,
} from "./errors.js"

// === Scan result types ===

/** A file or directory that was skipped during scanning and why. */
export interface SkippedEntry {
  readonly path: string
  readonly reason: string
}

/** Result of a file scan: discovered files and entries that were skipped. */
export interface ScanResult {
  readonly files: readonly string[]
  readonly skipped: readonly SkippedEntry[]
}

// === ConfigStore Port ===

export class ConfigStore extends Context.Tag("ConfigStore")<
  ConfigStore,
  {
    readonly readConfig: () => Effect.Effect<
      Config,
      ConfigError | ConfigNotFoundError | ConfigMalformedError
    >
    readonly writeConfig: (config: Config) => Effect.Effect<void, ConfigError | DiskFullError>
    readonly configExists: () => Effect.Effect<boolean>
  }
>() {}

// === Scanner Port ===

export class Scanner extends Context.Tag("Scanner")<
  Scanner,
  {
    /**
     * Scan project files, applying .gitignore rules (unless ignoreGitignore is true), ignoredPaths
     * patterns, and .git/info/exclude. Returns all discovered files. Per-entry skips are reported
     * in ScanResult.skipped. Fatal errors surface as ScanFailed.
     */
    readonly scanFiles: (
      ignoredPaths: readonly string[],
      ignoreGitignore?: boolean,
    ) => Effect.Effect<ScanResult, ScanFailed>
  }
>() {}

// === ContentExtractor Port ===

export class ContentExtractor extends Context.Tag("ContentExtractor")<
  ContentExtractor,
  {
    /** Extract text from a file. Fails with AllProcessorErrors if the format is unsupported. */
    readonly extract: (file: string) => Effect.Effect<string, AllProcessorErrors>
  }
>() {}

// === Chunker Port ===

export class Chunker extends Context.Tag("Chunker")<
  Chunker,
  {
    /** Chunk a single file. Fails with ChunkerError if the file cannot be read. */
    readonly chunkFile: (file: string) => Effect.Effect<readonly Chunk[], ChunkerError>
    /** Chunk raw text with a logical file path. Used by ContentExtractor after text extraction. */
    readonly chunkText: (
      text: string,
      file: string,
    ) => Effect.Effect<readonly Chunk[], ChunkerError>
  }
>() {}

// === Embedder Port ===

export class Embedder extends Context.Tag("Embedder")<
  Embedder,
  {
    /** Embed a single text. Fails with ModelLoadError or InferenceError. */
    readonly embed: (text: string) => Effect.Effect<Embedding, ModelLoadError | InferenceError>
    /** Batch-embed texts. Fails with ModelLoadError or InferenceError. */
    readonly batch: (
      texts: readonly string[],
    ) => Effect.Effect<readonly Embedding[], ModelLoadError | InferenceError>
    /** Returns fallback info if GPU failed and fell back to CPU. */
    readonly getFallbackInfo: () => Effect.Effect<
      { readonly originalDevice: string; readonly reason: string } | undefined
    >
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

/** Result of a reset operation — what was deleted and how many bytes were freed. */
export interface ResetResult {
  readonly deletedChunks: boolean
  readonly deletedVectors: boolean
  readonly freedBytes: number
}

/** Statistics returned after a successful store commit. */
export interface IndexStats {
  readonly chunks: number
  readonly files: number
  readonly totalLines: number
  readonly byteSize: number
}

export class VectorStore extends Context.Tag("VectorStore")<
  VectorStore,
  {
    readonly store: (
      chunks: readonly Chunk[],
      embeddings: readonly Embedding[],
    ) => Effect.Effect<void, StoreError | DiskFullError>
    /** Initialize transactional staging: clean stale temp files and reset accumulators. */
    readonly storeBegin: () => Effect.Effect<void, StoreError | DiskFullError>
    /**
     * Append a batch of chunks and embeddings to staging temp files. Called per batch during
     * streaming; sequential with no interleaving.
     */
    readonly storeBatch: (
      chunks: readonly Chunk[],
      embeddings: readonly Embedding[],
    ) => Effect.Effect<void, StoreError | DiskFullError>
    /** Commit staged data to final index files atomically and return accumulated stats. */
    readonly storeCommit: () => Effect.Effect<IndexStats, StoreError | DiskFullError>
    /** Abort staging and clean up temp files without committing. */
    readonly storeAbort: () => Effect.Effect<void, StoreError>
    readonly search: (
      query: Embedding,
      topK: number,
    ) => Effect.Effect<readonly SearchResult[], StoreError | NoIndexError>
    readonly getStatus: () => Effect.Effect<
      {
        chunks: number
        files: number
        model: string
        lastIndex: number
        totalLines: number
        byteSize: number
      },
      StoreError
    >
    readonly reset: () => Effect.Effect<ResetResult, StoreError | DiskFullError>
  }
>() {}
