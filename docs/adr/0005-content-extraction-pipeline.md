# ADR 0005: Content Extraction Pipeline

## Status

Accepted

## Context

The system previously used a simple extension whitelist (`Config.files: Record<string, number>`) to decide which files to index. All matched files went through Chunker → Embedder. There was no mechanism for:

- Detecting binary files accidentally included in the whitelist
- Transforming non-code files (PDF, images, etc.) to text before embedding
- Alerting users when a file type has no defined processing strategy

The priority weights in `files` were never used — only the keys were extracted.

## Decision

### ContentExtractor

A domain-level lookup table mapping file extensions to processing functions. Each processor is an `Effect<string, ProcessorError, FileSystem>` that extracts text from a file.

- **Identity processors** — code/text files (`.ts`, `.md`, `.py`) read as-is via `readFileString`
- **Skip processors** — binary/unsupported formats (`.pdf`, `.png`, `.mp4`) fail with `UnsupportedFormat`
- **Transform processors** (future) — PDF extraction, Whisper transcription, etc.

### Scanner simplification

Scanner returns all files found during FS walk, applying `.gitignore` rules, `.git/info/exclude`, and configurable `ignoredPaths` patterns. No extension filtering — that concern moved to `ContentExtractor`. `scanFiles(ignoredPaths)` applies ignore patterns during directory walk.

### Config change

Replaced `files: Record<string, number>` with `skipExtensions: readonly string[]`. Domain processor map is always the base; config overrides swap entries to skip.

### Chunker refactor

Chunking exposes the `chunkText(text, file, options?)` port method. File reading remains in the
application pipeline, so all extraction flows through `chunkText` before embedding.

### Unknown extensions

Skipped and collected in a set, reported at end of scan. Index pipeline continues — does not fail.

### Orchestration

`Effect.forEach` with concurrency for now. Processors are Effect-typed functions, making them Stream-ready for future streaming pipeline implementation without rewriting processors.

## Rationale

The extension→processor mapping was chosen over a simple whitelist because it separates file discovery from file processing, enabling future transform pipelines (PDF extraction, audio transcription) without changing the scanner or chunker. The opt-out `skipExtensions` config is simpler for users than maintaining a whitelist — most projects only need to exclude a few types rather than enumerate all supported ones. Keeping processors as plain `Effect` functions (not a `Context.Service`) avoids unnecessary indirection for a lookup table that is deterministic and doesn't need swapping at runtime.

## Consequences

### Positive

- Single source of truth for file processing decisions
- Scanner is simpler, focused on file discovery
- Extensible for future transforms (PDF, MP3, etc.)
- Memory-efficient streaming path is natural next step
- Users can opt out of specific extensions via config

### Negative

- Larger domain surface area (new error types, port methods)
- Default processor map needs maintenance as new file types emerge

### Risks

- Processor map size grows — mitigated by lazy loading transforms only when needed
- Unknown extensions skipped but surfaced to users via warnings and a summary report at end
