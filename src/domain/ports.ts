import { Context, Effect, Option } from "effect"
import type { Stream } from "effect"

import type { Chunk, Embedding } from "./chunk.js"
import type { Config } from "./config.js"
import type { DeviceType } from "./device.js"
import type { EmbeddingDtype } from "./dtype.js"
import type { DtypeMismatchError, IndexMeta, VectorDecodeError } from "./dtype.js"
import type {
  AllConfigErrors,
  ClipboardError,
  AliasNotFoundError,
  AliasStoreError,
  AliasValidationError,
  ChunkValidationError,
  ConfigError,
  ConfigMalformedError,
  ConfigNotFoundError,
  ConfigValidationError,
  DiskFullError,
  InteractiveError,
  NoIndexError,
  StoreError,
  ModelLoadError,
  InferenceError,
  AllProcessorErrors,
} from "./errors.js"
import type { IdentifierIndexMaps } from "./identifier-index.js"
import type { Identifier } from "./identifier.js"
import type { FileManifestEntry, StoredChunk } from "./index-data.js"
import type { ModelInfo } from "./models.js"
import type { QueryAlias, QueryAliasOptions } from "./query-alias.js"
import type { ProductionProfileName } from "./retrieval.js"
import type { SparseContract, SparseQuery, SparseTerm, SparseVector } from "./sparse.js"

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
  readonly files: readonly ScannedFile[]
  readonly skipped: readonly SkippedEntry[]
}

/** Source file discovered with cheap freshness metadata from the same directory walk. */
export interface ScannedFile {
  readonly path: string
  readonly mtimeMs: number
  readonly size: number
}

// === ConfigStore Port ===

/** A conflict found during config heal — a field value that violates a coupled rule. */
export interface HealConflict {
  /** Dotted path to the conflicting field (e.g. "embedder.dtype"). */
  readonly field: string
  /** The invalid value currently in the config. */
  readonly currentValue: string
  /** Valid values the user/agent can choose from. */
  readonly validOptions: readonly string[]
  /** Human-readable explanation of why this is a conflict. */
  readonly reason: string
  /** True if the conflict was auto-resolved with a default value. */
  readonly healed: boolean
  /** The value applied if healed (undefined if not healed). */
  readonly healedValue?: string
}

/** Result of healConfig — the healed config plus a list of all conflicts found. */
interface HealPlan {
  readonly config: Config
  readonly conflicts: ReadonlyArray<HealConflict>
}

/** Port for reading/writing `.pix/config.json`. */
export class ConfigStore extends Context.Service<
  ConfigStore,
  {
    /** Read and heal config in memory. Fails on unhealable conflicts (unknown model). */
    readonly readConfig: () => Effect.Effect<Config, AllConfigErrors>
    /** Read and heal config, returning a full plan with all conflicts (including unhealed). */
    readonly healConfig: () => Effect.Effect<
      HealPlan,
      ConfigError | ConfigNotFoundError | ConfigMalformedError | ConfigValidationError
    >
    readonly writeConfig: (config: Config) => Effect.Effect<void, ConfigError | DiskFullError>
    readonly configExists: () => Effect.Effect<boolean>
  }
>()("ConfigStore") {}

// === ModelRegistry Port ===

/** Port for querying embedding model metadata (dtypes, dims, defaults). */
export class ModelRegistry extends Context.Service<
  ModelRegistry,
  {
    /** Look up model info by HuggingFace model identifier. Returns Option.none if unknown. */
    readonly get: (id: string) => Effect.Effect<Option.Option<ModelInfo>>
    /** List all registered model IDs. */
    readonly list: () => Effect.Effect<readonly string[]>
  }
>()("ModelRegistry") {}

// === Scanner Port ===

/** Port for discovering files to index. */
export class Scanner extends Context.Service<
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
>()("Scanner") {}

// === ContentExtractor Port ===

/** Port for extracting text content from files. */
export class ContentExtractor extends Context.Service<
  ContentExtractor,
  {
    /** Extract text from a file. Fails with AllProcessorErrors if the format is unsupported. */
    readonly extract: (file: string) => Effect.Effect<string, AllProcessorErrors>
  }
>()("ContentExtractor") {}

// === Chunker Port ===

/** Port for splitting source text into chunks for embedding. */
export class Chunker extends Context.Service<
  Chunker,
  {
    /** Chunk raw text with a logical file path. Used by ContentExtractor after text extraction. */
    readonly chunkText: (text: string, file: string) => Effect.Effect<readonly Chunk[]>
  }
>()("Chunker") {}

// === IdentifierExtractor Port ===

/** Port for extracting code identifiers from source text. */
export class IdentifierExtractor extends Context.Service<
  IdentifierExtractor,
  {
    /**
     * Extract named identifiers (functions, types, values) from a chunk via the language's
     * tree-sitter grammar. The `file` argument drives parser dispatch (TS for `.ts`/`.js`, TSX for
     * `.tsx`/`.jsx`; non-code extensions return []). Returns the identifier name, language-agnostic
     * kind, and the chunk's index. Tree-sitter always produces a (possibly partial) parse tree, so
     * this never fails -- malformed input is silently allowed.
     */
    readonly extractIdentifiers: (
      file: string,
      text: string,
      chunkIndex: number,
    ) => Effect.Effect<readonly Identifier[], never>
  }
>()("IdentifierExtractor") {}

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
export class Embedder extends Context.Service<
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
>()("Embedder") {}

/** Port for learned sparse document and query encoding. */
export class SparseEmbedder extends Context.Service<
  SparseEmbedder,
  {
    /** Versioned model/tokenizer/IDF contract used for persistence and reuse checks. */
    readonly contract: SparseContract
    /** Encode source chunks with the learned document transformer. */
    readonly batch: (
      texts: readonly string[],
    ) => Effect.Effect<readonly SparseVector[], ModelLoadError | InferenceError>
    /** Load and hash-verify the complete static query-IDF table for index persistence. */
    readonly loadIdf: () => Effect.Effect<readonly SparseTerm[], ModelLoadError>
    /** Tokenize a query for SQLite's persisted static IDF lookup. */
    readonly tokenizeQuery: (
      text: string,
    ) => Effect.Effect<SparseQuery, ModelLoadError | InferenceError>
  }
>()("SparseEmbedder") {}

// === DeviceDetection Port ===

/** Port for detecting available embedding compute devices. */
export class DeviceDetection extends Context.Service<
  DeviceDetection,
  {
    /** Detect the best available device by attempting model load on each device in priority order. */
    readonly detect: (model: string, dtype: string) => Effect.Effect<DeviceType, ModelLoadError>
    /** Test all devices independently and return the working devices in priority order. */
    readonly detectAll: (
      model: string,
      dtype: string,
    ) => Effect.Effect<readonly DeviceType[], never>
  }
>()("DeviceDetection") {}

// === IndexStore Port ===

/** Pre-built BM25 corpus statistics stored in the SQLite index. */
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

/** Chunk metadata shared by retrieval channels and result hydration. */
export interface ChunkMetadata {
  readonly index: number
  readonly id: string
  readonly idx: number
  readonly file: string
  readonly startLine: number
  readonly endLine: number
  readonly startOffset: number
  readonly endOffset: number
  readonly contentHash: string
}

/** Chunk metadata plus its vector, loaded only for incremental index planning. */
export interface ChunkEntry extends ChunkMetadata {
  readonly vector: Float32Array
  readonly sparseVector: SparseVector
}

/** All index data needed at query time for hybrid search. */
export interface SearchData {
  readonly entries: readonly ChunkMetadata[]
  readonly bm25Index: Bm25Index
  /**
   * Identifier index for the identity and camelCase scoring channels. Empty maps if the file is
   * missing.
   */
  readonly identifierIndex: IdentifierIndexMaps
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
  /** Number of live source lines to load before and after each selected result. */
  readonly contextLines?: number
  /** Skip source hydration and return metadata-only results. */
  readonly noContent?: boolean
  /** Explicit production retrieval profile. */
  readonly profile?: ProductionProfileName
}

/** A single search result from a semantic query. Results are sorted by similarity score descending. */
export interface SearchResult {
  /** Raw RRF fusion score (internal — use `rel` for human-friendly display). */
  readonly score: number
  /** Normalised relevance score on [0, ~1] scale. score * K / sumWeights. */
  readonly rel: number
  /** Repository-relative file path of the source file. */
  readonly file: string
  /** 1-based start line of the chunk in the source file. */
  readonly startLine: number
  /** 1-based end line (inclusive) of the chunk in the source file. */
  readonly endLine: number
  /** The chunk's source text, or null when metadata-only output was requested. */
  readonly text: string | null
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

/** One batch of `(chunk, embedding)` pairs handed to `IndexStore.persistIndex`. */
export type ChunkBatch = ReadonlyArray<readonly [StoredChunk, Embedding, SparseVector]>

/** Input handed to `IndexStore.persistIndex` — a stream of batches plus the identifier index. */
export interface PersistIndexInput<E = never> {
  /** Stream of chunk/embedding batches. Drained lazily; each batch is persisted as it arrives. */
  readonly chunks: Stream.Stream<ChunkBatch, E>
  /** Identifier index for the five-channel hybrid retrieval. */
  readonly identifierIndex: IdentifierIndexMaps
  /** Complete BM25 index for retained and newly processed chunks. */
  readonly bm25Index: Bm25Index
  /** Source observations committed atomically with this index snapshot. */
  readonly files: readonly FileManifestEntry[]
  /** Vector dimensions recorded even when the index contains no chunks. */
  readonly dims: number
  /** Vector storage dtype recorded even when the index contains no chunks. */
  readonly dtype: EmbeddingDtype
  /** Historical embeddings not already present in the active vectors file. */
  readonly embeddingCache: readonly CachedEmbedding[]
  /** Historical sparse vectors not already present in the active postings. */
  readonly sparseEmbeddingCache: readonly CachedSparseEmbedding[]
  /** Versioned sparse contract committed atomically with all sparse postings. */
  readonly sparseContract: SparseContract
  /** Static query-IDF table paired with the sparse contract. */
  readonly sparseIdf: readonly SparseTerm[]
}

/** Decoded embedding retained across index runs by content and embedding contract. */
export interface CachedEmbedding {
  readonly contentHash: string
  readonly model: string
  readonly embedding: Embedding
}

/** Decoded sparse vector retained across index runs by content and sparse contract. */
export interface CachedSparseEmbedding {
  readonly contentHash: string
  readonly contract: SparseContract
  readonly vector: SparseVector
}

/** Committed index data used to plan an incremental refresh. */
export interface IndexSnapshot extends SearchData {
  readonly entries: readonly ChunkEntry[]
  readonly meta: IndexMeta
  readonly files: readonly FileManifestEntry[]
  readonly sparseContract: SparseContract
  readonly sparseIdf: readonly SparseTerm[]
}

/** Exact persisted range requested for lazy source hydration. */
export interface SourceRequest {
  readonly file: string
  readonly startLine: number
  readonly endLine: number
  readonly startOffset: number
  readonly endOffset: number
  readonly contentHash: string
  readonly contextLines: number
}

/** Source text and context loaded after ranking selects a result. */
export interface SourceContent {
  readonly text: string
  readonly contextBefore: string | null
  readonly contextAfter: string | null
}

/** Port for persisting chunks and embeddings and querying the index. */
export class IndexStore extends Context.Service<
  IndexStore,
  {
    /**
     * Persist a complete index by draining chunk/embedding batches inside one adapter-owned
     * transaction. Any failure preserves the previous committed snapshot. Returns final stats.
     */
    readonly persistIndex: <E>(
      input: PersistIndexInput<E>,
    ) => Effect.Effect<IndexStats, StoreError | DiskFullError | E>
    /** Load all index data needed for hybrid search (chunks + vectors + BM25 + identifiers). */
    readonly loadSearchData: () => Effect.Effect<
      SearchData,
      StoreError | NoIndexError | DtypeMismatchError | VectorDecodeError
    >
    /** Rank active chunks through SQLite vector search without loading vectors into JavaScript. */
    readonly searchDense: (
      embedding: Embedding,
    ) => Effect.Effect<readonly RankedChunk[], StoreError | NoIndexError | VectorDecodeError>
    /** Rank active chunks by exact sparse inner product over indexed token postings. */
    readonly searchSparse: (
      query: SparseQuery,
    ) => Effect.Effect<readonly RankedChunk[], StoreError | NoIndexError>
    /** Load and verify source text for one selected chunk. */
    readonly loadSource: (request: SourceRequest) => Effect.Effect<SourceContent, StoreError>
    /** Load all valid content-addressed embeddings. Missing cache returns an empty list. */
    readonly loadEmbeddingCache: () => Effect.Effect<readonly CachedEmbedding[], StoreError>
    /** Load all valid content-addressed sparse vectors. Missing cache returns an empty list. */
    readonly loadSparseEmbeddingCache: () => Effect.Effect<
      readonly CachedSparseEmbedding[],
      StoreError
    >
    /** Remove both optional embedding caches without touching the committed index. */
    readonly clearEmbeddingCache: () => Effect.Effect<boolean, StoreError | DiskFullError>
    /** Load the committed snapshot without comparing it to current config. */
    readonly loadIndexSnapshot: () => Effect.Effect<Option.Option<IndexSnapshot>, StoreError>
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
>()("IndexStore") {}

// === Clipboard Port ===

/** Port for copying text to the system clipboard. */
export class Clipboard extends Context.Service<
  Clipboard,
  {
    /** Copy text to the active system clipboard. */
    readonly copy: (text: string) => Effect.Effect<void, ClipboardError>
  }
>()("Clipboard") {}

// === QueryAliasStore Port ===

/** Port for persisting named query aliases in `.pix/aliases.json`. */
export class QueryAliasStore extends Context.Service<
  QueryAliasStore,
  {
    /** Save or replace a query alias. */
    readonly save: (
      name: string,
      queryText: string,
      options: QueryAliasOptions,
    ) => Effect.Effect<QueryAlias, AliasStoreError | AliasValidationError>
    /** List all aliases sorted by name. */
    readonly list: () => Effect.Effect<readonly QueryAlias[], AliasStoreError>
    /** Load a query alias by name. */
    readonly get: (
      name: string,
    ) => Effect.Effect<QueryAlias, AliasStoreError | AliasValidationError | AliasNotFoundError>
    /** Remove a query alias by name. */
    readonly remove: (
      name: string,
    ) => Effect.Effect<void, AliasStoreError | AliasValidationError | AliasNotFoundError>
  }
>()("QueryAliasStore") {}

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

/** Option for the select method — a labeled value the user can choose. */
export interface SelectOption<T> {
  readonly value: T
  readonly label: string
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
  /**
   * Interactive single-select prompt. Returns the selected option's value as a string; clack
   * symbol-cancel is reported as an `InteractiveError` failure.
   */
  readonly select: (
    message: string,
    options: ReadonlyArray<SelectOption<string>>,
    defaultValue?: string,
  ) => Effect.Effect<string, InteractiveError>
  readonly json: (data: unknown) => Effect.Effect<void>
}

/** Port for all CLI output — human interactive, JSON, and file audit trail. */
export class Display extends Context.Service<Display, DisplayService>()("Display") {}
