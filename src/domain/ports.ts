import { Context, Effect } from "effect"

import type { Chunk } from "./chunk.js"
import type { Embedding } from "./chunk.js"
import type { Config } from "./config.js"
import type {
  AllConfigErrors,
  ChunkValidationError,
  ConfigError,
  DiskFullError,
  NoIndexError,
  StoreError,
  ChunkerError,
  ModelLoadError,
  InferenceError,
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

/** Port for reading/writing `.pix/config.json`. */
export class ConfigStore extends Context.Tag("ConfigStore")<
  ConfigStore,
  {
    readonly readConfig: () => Effect.Effect<Config, AllConfigErrors>
    readonly writeConfig: (config: Config) => Effect.Effect<void, ConfigError | DiskFullError>
    readonly configExists: () => Effect.Effect<boolean>
  }
>() {}

// === Scanner Port ===

/** Port for discovering files to index. */
export class Scanner extends Context.Tag("Scanner")<
  Scanner,
  {
    /**
     * Scan project files, applying .gitignore rules (unless ignoreGitignore is true), ignoredPaths
     * patterns, and .git/info/exclude. Returns all discovered files. Per-entry skips are reported
     * in ScanResult.skipped. Fatal errors are caught and logged as skipped entries.
     */
    readonly scanFiles: (
      ignoredPaths: readonly string[],
      ignoreGitignore?: boolean,
    ) => Effect.Effect<ScanResult, never>
  }
>() {}

// === ContentExtractor Port ===

/** Port for extracting text content from files. */
export class ContentExtractor extends Context.Tag("ContentExtractor")<
  ContentExtractor,
  {
    /** Extract text from a file. Fails with AllProcessorErrors if the format is unsupported. */
    readonly extract: (file: string) => Effect.Effect<string, AllProcessorErrors>
  }
>() {}

// === Chunker Port ===

/** Port for splitting source text into chunks for embedding. */
export class Chunker extends Context.Tag("Chunker")<
  Chunker,
  {
    /** Chunk raw text with a logical file path. Used by ContentExtractor after text extraction. */
    readonly chunkText: (
      text: string,
      file: string,
    ) => Effect.Effect<readonly Chunk[], ChunkerError>
  }
>() {}

// === Embedder Port ===

/** Port for creating vector embeddings from text. */
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

/** Options for searching the vector store. All fields are optional — omitted = use default. */
export interface SearchOptions {
  /** Maximum number of results to return. Default: no limit. */
  readonly topK?: number
  /**
   * Gitignore-style patterns. Files matching any pattern are excluded from results. Default: no
   * filtering.
   */
  readonly ignorePaths?: readonly string[]
  /**
   * Gitignore-style patterns. Only files matching at least one pattern are included. Default: no
   * filtering.
   */
  readonly onlyPaths?: readonly string[]
}

/** A single search result from a semantic query. Results are sorted by similarity score descending. */
export interface SearchResult {
  /** Cosine similarity score between the query embedding and this chunk's embedding. */
  readonly score: number
  /** Repository-relative file path of the source file. */
  readonly file: string
  /** 1-based start line of the chunk in the source file. */
  readonly startLine: number
  /** 1-based end line (inclusive) of the chunk in the source file. */
  readonly endLine: number
  /** The chunk's source text (may be truncated when --max-characters is used). */
  readonly text: string
  /** Lines immediately preceding the chunk. Null when not requested or when truncated. */
  readonly contextBefore: string | null
  /** Lines immediately following the chunk. Null when not requested or when truncated. */
  readonly contextAfter: string | null
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

/** Result of a search operation, including any chunk line validation errors encountered. */
export interface SearchResponse {
  readonly results: readonly SearchResult[]
  readonly validationErrors: readonly ChunkValidationError[]
}

/** Port for persisting chunks and embeddings and querying the index. */
export class VectorStore extends Context.Tag("VectorStore")<
  VectorStore,
  {
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
    /** Search the index with an embedding, returning similar chunks. */
    readonly search: (
      query: Embedding,
      options?: SearchOptions,
    ) => Effect.Effect<SearchResponse, StoreError | NoIndexError>
    /** Return index statistics: chunk/file counts, model, last index time, etc. */
    readonly getStatus: () => Effect.Effect<
      {
        chunks: number
        files: number
        model: string
        lastIndex: number
        totalLines: number
        byteSize: number
        validationErrors: readonly ChunkValidationError[]
      },
      StoreError
    >
    /** Delete all index data (chunks + vectors) and return what was freed. */
    readonly reset: () => Effect.Effect<ResetResult, StoreError | DiskFullError>
  }
>() {}

// === Logger Port ===

/** Port for emitting warnings from infrastructure code without depending on Display. */
export class Logger extends Context.Tag("Logger")<
  Logger,
  {
    readonly warn: (message: string) => Effect.Effect<void>
  }
>() {}
