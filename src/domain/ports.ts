import { Context, Effect } from "effect"

import type { DeviceType } from "../services/device-detect.js"
import type { Chunk, Embedding } from "./chunk.js"
import type { Config } from "./config.js"
import type { EmbeddingDtype } from "./dtype.js"
import type { DtypeMismatchError, VectorDecodeError } from "./dtype.js"
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

// === Index options ===

/** Options for the index operation, typically from CLI flags. */
export interface IndexOptions {
  readonly batchSize?: number
  readonly chunkConcurrency?: number
  readonly skipExtensions?: readonly string[]
  readonly ignorePaths?: readonly string[]
  readonly ignoreGitignore?: boolean
}

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

/** Configuration for creating an embedder for a specific device. */
export interface EmbedderDeviceConfig {
  readonly device: DeviceType
  readonly model: string
  readonly dtype: EmbeddingDtype
  readonly dims: number
}

/** An embedder instance bound to a specific device configuration. */
export interface BoundEmbedder {
  readonly embed: (text: string) => Effect.Effect<Embedding, ModelLoadError | InferenceError>
  readonly batch: (
    texts: readonly string[],
  ) => Effect.Effect<ReadonlyArray<Embedding>, ModelLoadError | InferenceError>
}

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
    /** Create a fresh embedder instance for a specific device (used by benchmark). */
    readonly createForDevice: (
      cfg: EmbedderDeviceConfig,
    ) => Effect.Effect<BoundEmbedder, ModelLoadError>
  }
>() {}

// === IndexStore Port ===

/** Pre-built BM25 corpus statistics stored in .pix/bm25.json. */
export interface Bm25Index {
  readonly avgChunkLength: number
  readonly chunkLengths: readonly number[]
  readonly docFreqs: Record<string, number>
  readonly chunkTfs: Record<string, ReadonlyArray<readonly [number, number]>>
}

/** A single scored chunk from a scorer, before RRF fusion. */
export interface RankedChunk {
  readonly chunkIndex: number
  readonly score: number
}

/** Raw chunk data loaded from the index for passing to scorers at query time. */
export interface ChunkEntry {
  readonly index: number
  readonly file: string
  readonly startLine: number
  readonly endLine: number
  readonly text: string
  readonly vector: Float32Array
  readonly contextBefore: string | null
  readonly contextAfter: string | null
}

/** All index data needed at query time for hybrid search. */
export interface SearchData {
  readonly entries: readonly ChunkEntry[]
  readonly bm25Index: Bm25Index
  readonly malformedLines: number
}

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
export class IndexStore extends Context.Tag("IndexStore")<
  IndexStore,
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
    /** Load all index data needed for hybrid search (chunks + vectors + BM25 stats). */
    readonly loadSearchData: () => Effect.Effect<
      SearchData,
      StoreError | NoIndexError | DtypeMismatchError | VectorDecodeError
    >
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

// === Display Port ===

/** Severity level for log messages */
export type DisplaySeverity = "info" | "success" | "warn" | "error"

/** Options for the progress bar method */
export type DisplayProgressOptions = {
  readonly message: string
  readonly max: number
  readonly style?: "light" | "heavy" | "block"
  readonly size?: number
  readonly indicator?: "dots" | "timer"
  readonly stopMessage?: string
}

/** Payload for updateInteractive — plain string updates text, object adds position control */
export type DisplayUpdatePayload =
  | string
  | {
      readonly message: string
      readonly advanceBy?: never
      readonly setTo?: never
      readonly setToPercent?: never
    }
  | {
      readonly message: string
      readonly advanceBy: number
      readonly setTo?: never
      readonly setToPercent?: never
    }
  | {
      readonly message: string
      readonly setToPercent: number
      readonly advanceBy?: never
      readonly setTo?: never
    }
  | {
      readonly message: string
      readonly setTo: number
      readonly advanceBy?: never
      readonly setToPercent?: never
    }

/** Display service — abstracts CLI output behind structured methods */
export interface DisplayService {
  readonly intro: (title: string) => Effect.Effect<void>
  readonly outro: (message: string) => Effect.Effect<void>
  readonly log: (message: string, severity: DisplaySeverity) => Effect.Effect<void>
  readonly note: (content: string, title?: string) => Effect.Effect<void>
  readonly text: (message: string) => Effect.Effect<void>
  readonly table: (
    header: readonly string[],
    rows: readonly (readonly string[])[],
  ) => Effect.Effect<void>
  readonly spinner: <A, E, R>(
    message: string,
    effect: Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E, R>
  readonly progress: <A, E, R>(
    opts: DisplayProgressOptions,
    effect: Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E, R>
  readonly updateInteractive: (payload: DisplayUpdatePayload) => Effect.Effect<void>
  readonly json: (data: unknown) => Effect.Effect<void>
}

/** Port for all CLI output — human interactive, JSON, and file audit trail. */
export class Display extends Context.Tag("Display")<Display, DisplayService>() {}
