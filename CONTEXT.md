# pix — Context

## Glossary

### Chunk

A piece of source code produced by the chunker. One chunk = N lines of code with overlap.
Stored as one line in `chunks.jsonl`. Maximum size guided by 60 lines (configurable `chunkLines`), with `overlapLines` lines overlapping between consecutive chunks.
Chunk-ID = `sha1(file:startLine).slice(0, 12)`.
Minimum chunk size: 20 characters (hardcoded for MVP, TODO: promote to configurable).

### Config

Runtime configuration stored in `.pix/config.json`. Contains model name, dimensions, chunk parameters, file mtime cache.
Schema version: "1".

### Embedder

Component that turns text into vectors. MVP uses ONNX runtime with `Xenova/all-MiniLM-L6-v2` (22 MB, 384 dims, q8 quantized, CPU).
Model cache lives in `.pix/cache/`. Batch size default: 16 (configurable).

### Scanner

Discovers files to index. Walks the project tree via `FileSystem.FileSystem`, applies `.gitignore` rules via the `ignore` package, and returns all files. Extension-based filtering is handled downstream by the ContentExtractor processor map. Configurable `ignoredPaths` patterns (gitignore-style) merged with `.gitignore` and `.git/info/exclude`. Always ignores: `.pix`, `node_modules`, `.git`, `dist`, `build`, `.next`.

### Store

Reads/writes the `.pix/` directory: `config.json`, `chunks.jsonl`, `vectors.bin`.
`vectors.bin` = flat `Float32Array`, row-major, `n × 384` floats.

### MVP Scope

init, index, query, status, reset. No incremental indexing, no cloud providers, no GUI.

### Effect

Runtime and CLI framework (`effect`, `@effect/cli`, `@effect/platform-node`). Chosen as a learning project and foundation for typed errors + structured concurrency.

### fallow

Rust-native codebase intelligence tool for TS/JS. Finds dead code, duplication, complexity hotspots.
Used as quality gate: `fallow --format json` after type-checking and tests.

### Adapter Test

Tests a single adapter (`src/services/*.ts`) with its real implementation against MemoryFileSystem. Only mocks dependencies that literally cannot run in CI (e.g. ONNX embedder). Asserts on domain types, not mock side-effects.

### Use Case Test

Tests a single use case (`src/application/*.ts`) through `testLayer()` with real adapters underneath. Asserts the domain result (e.g. `IndexResult`), not CLI output or console side-effects.

### Display Service

`Context.Tag("Display")` in `src/display/Display.ts`. Abstracts all CLI output behind structured methods. Commands and services use `yield* Display` — never `Console.log` or `Effect.logInfo` directly.

Methods:

| Method                       | Effect                                                                      | Human               | JSON           |
| ---------------------------- | --------------------------------------------------------------------------- | ------------------- | -------------- |
| `intro(title)`               | Opens a frame header                                                        | `clack.intro`       | no-op          |
| `outro(msg)`                 | Closes a frame                                                              | `clack.outro`       | no-op          |
| `log(msg, sev)`              | Styled permanent line (severity: info/success/warn/error)                   | `clack.log.*`       | no-op          |
| `note(content, title?)`      | Boxed note block                                                            | `clack.note`        | no-op          |
| `text(msg)`                  | Plain unstyled output line                                                  | `clack.log.message` | no-op          |
| `spinner(msg, eff)`          | Wrap effect with spinner (live text updates via `d.updateInteractive`)      | runs spinner        | runs effect    |
| `progress(opts, eff)`        | Wrap effect with progress bar (also accepts `d.updateInteractive` payloads) | runs bar            | runs effect    |
| `updateInteractive(payload)` | Update text & optionally advance progress bar                               | see below           | no-op          |
| `json(data)`                 | Structured agent output                                                     | no-op               | `stdout.write` |

**`d.updateInteractive(payload)` payloads** (discriminated union, exclusive keys via `never`):

| Shape                          | Effect on spinner    | Effect on progress bar                              |
| ------------------------------ | -------------------- | --------------------------------------------------- |
| `"text"`                       | `s.message("text")`  | `b.advance(0, "text")`                              |
| `{ message }`                  | same as string       | same as string                                      |
| `{ message, advanceBy: N }`    | ignores advanceBy    | `b.advance(N, msg)`; state += N                     |
| `{ message, setTo: N }`        | ignores setTo        | `b.advance(N - state, msg)`; state = N              |
| `{ message, setToPercent: P }` | ignores setToPercent | `b.advance(target - state, msg)`; state = P% of max |

The progress bar's `{ value, max }` state is tracked immutably inside a `Ref` since `@clack` only exposes `advance(step)` — we compute the delta and clamp to `[0, max]`. Spinners ignore numeric fields.

Three implementations:

- **ClackDisplay** (`--json` not set): renders via `@clack/prompts` with spinners, styled icons, frames. Uses `Layer.effect` with a `Ref<ActiveInteractive>` scoped to the layer lifecycle — double-open (nested spinner/progress) silently ignores the second call and runs the effect directly.
- **JsonDisplay** (`--json` set): no-ops all interactive methods; `json()` writes to `stdout`
- **SilentDisplay** (tests): records `DisplayEntry[]` to a `Ref` for test assertions. Spinner/progress entries are recorded on scope entry (before the wrapped effect runs) for reliable assertions regardless of outcome.

**`DisplayEntry`**: Defined via `Data.TaggedEnum<{ intro, outro, log, note, text, spinner, progress, updateInteractive, json }>`. Provides typed constructors (`DisplayEntry.log({ message, severity })`) instead of manual `{ _tag: "log" as const, ... }` objects.

### Silent Display (test)

`tests/test-utils/silentDisplay.ts` creates a `Ref<DisplayEntry[]>` backed `SilentDisplay` layer for Command tests. Replaced the old `MockConsole` approach. Tests assert on structured entries (`entries[0]._tag === "json"`) instead of parsing raw stdout lines.

### Command Test

Tests the full `Command.run` → all layers → CLI output path. Exercises the composition root. Asserts on `SilentDisplay` ref entries or `Exit` status from `Command.run`.

### Default Embedder (test)

Zero-vector mock Embedder provided by `testLayer()`. Returns `Float32Array(384)` of zeros for every embedding. Used in Use Case and Command tests where real embeddings are irrelevant to the assertion.

### Memory FileSystem Layer

Shared utility for Adapter tests. Builds a `MemoryFileSystem.layer` pre-populated with fixture contents — the sole `FileSystem` provider with no competing real-FS implementation. Exported from `tests/test-utils/memfs.ts`. Adapter tests use minimal layers (`Layer.provideMerge(AdapterLive, memoryFsLayer(fixtures))`); Use Case and Command tests use the full `testLayer()`.

### Decision Coverage

The quality gate for tests: every branch (`if`, `Effect.catchTag`, `Exit`, fallback path) in `src/services/` and `src/application/` must be exercised at least once. No numerical line-coverage target; 0% branches in any file is a failure. Named for the decision-tree coverage it demands.

### Test Layer (`testLayer()`)

Factory in `tests/test-utils/testLayer.ts` that builds the full application layer against `MemoryFileSystem` with mocked Scanner and Embedder by default. Accepts overrides via `{ contents, scannerLayer, embedderLayer, displayLayer }` for fixture-driven test scenarios. Command tests supply `displayLayer` (via `silentDisplay()`) for output assertions.

### Embedder Mocking Policy

The ONNX Embedder is the **only** adapter permitted to be real in its Adapter test (`embedder.test.ts`) — all other test categories (Use Case, Command, other Adapter tests) must mock it via `defaultEmbedderLayer` (zero-vectors). Rationale: model correctness is tested once in isolation; speed and determinism matter everywhere else.

### Agent-ready

Structured JSON output on stdout (not stderr). Enables piping between `pix` and AI agents.

### CI (Continuous Integration)

Automated quality pipeline on PR to `main`: format + lint + type-check + test + build.
Effect diagnostics and fallow audit run non-blocking for surfacing insights. See [ADR 0004](docs/adr/0004-ci-cd-pipeline.md).

### Conventional Commits

Commit message convention: `feat:` (minor bump), `fix:` (patch bump), `feat!:` / `BREAKING CHANGE:` (major bump). Used by release-please to determine semver and generate changelogs.

### release-please

Google tool that scans conventional commits on `main`, opens release PRs with version bumps and changelog updates. Merge the PR to trigger publish.

### CodeRabbit

Automated PR code review, free for open source.

### Hexagonal Architecture (Ports & Adapters)

pix follows hexagonal architecture with three DDD layers. See [ADR 0003](docs/adr/0003-hexagonal-architecture.md).

### Port

A `Context.Tag` interface in `src/domain/ports.ts` declaring what the application needs — no implementation, no I/O. Examples: `ConfigStore`, `Scanner`, `Embedder`, `VectorStore`, `Chunker`.

### Adapter

A concrete implementation of a port, living in `src/services/`. Each adapter is an `Effect.Layer`. Example: `OnnxEmbedderLive` provides `Embedder`; `VectorStoreLive` provides `VectorStore`.

### Domain Layer (`src/domain/`)

Pure TypeScript types — no Effect, no I/O. Entities (`Config`, `Chunk`), value objects (`Embedding`), error types (`ConfigError`), and port declarations.

### Application Layer (`src/application/`)

Use cases as `Effect.Service` classes. Orchestration only — declares port dependencies via `yield*`, never touches files or ONNX directly. Examples: `InitProject`, `IndexProject`, `QueryProject`, `GetStatus`.

### Infrastructure Layer (`src/services/`)

Concrete adapters implementing domain ports. Reads/writes files, runs ONNX models, shells out. Each provides an `Effect.Layer` for its port tag.

### Use Case

A single business operation in the application layer. Depends on ports via Effect tags. Testable with mock adapters.

### Composition Root (`src/index.ts`)

Single entry point that wires all layers: infrastructure → chunker → application → CLI. All dependencies satisfied in one place.

### CLI Commands

- `pix init` — Create `.pix/config.json` with defaults
- `pix index` — Scan, chunk, embed, store (full re-index). Two-phase pipeline: Phase 1 (extract + chunk, spinner), Phase 2 (embed + store, progress bar). CLI flags override config: `--batch-size`, `--chunk-concurrency`, `--skip-extensions`, `--ignore-path`/`--ignore-paths`, `--ignore-gitignore`. Uses spinner for Phase 1, progress bar for Phase 2.
- `pix query "<text>" [--top N] [--json] [--context-lines N]` — Semantic search via cosine similarity
- `pix status` — Show index statistics
- `pix reset` — Delete `chunks.jsonl` + `vectors.bin`

All commands support `--json` for agent-ready structured output on stdout. Single JSON object emitted at end of successful operations (e.g. `{ chunks, files, totalLines, byteSize, durationMs }`). Error output uses `reportError` which calls both `d.log(..., "error")` (human) and `d.json(error)` (agent).

## Architecture Decisions

### Display service with JSON mode switching

CLI output goes through a `Display` context tag (`src/display/Display.ts`). Two production implementations selectable by `--json`: `ClackDisplay` (interactive, uses `@clack/prompts` for spinners, styled status, frames) and `JsonDisplay` (machine-readable, no-ops interactive methods, writes JSON to stdout). A third implementation (`SilentDisplay`) records calls to a `Ref<DisplayEntry[]>` for test assertions.

**Output separation**: `ClackDisplay.json` is a no-op — structured output never appears in human mode. `JsonDisplay` no-ops all interactive methods. Each Display handles its own surface. Commands call all methods unconditionally; no `if (!json)` branching. Error output uses `reportError` which calls both `d.log(..., "error")` (human) and `d.json(error)` (agent) — ClackDisplay renders the log, JsonDisplay emits the JSON.

**Interactive constraints**: Only one interactive line (spinner or progress bar) at a time. `d.updateInteractive(msg)` calls `s.message(msg)` on the active spinner or computes delta + calls `b.advance(delta, msg)` on the active progress bar. `d.progress()` stops any active spinner before starting the progress bar.

For spinners, text updates are sufficient visual feedback. For progress bars, `d.updateInteractive()` supports three position controls via discriminated union:

- `advanceBy: N` — advance the bar by N steps relative to current position
- `setTo: N` — jump to absolute position N (clamped to `[0, max]`)
- `setToPercent: P` — jump to P% of max (clamped to `[0, 100]`)

Position state is tracked locally (`state: { value, max }`) since `@clack` only exposes `advance(step)`. All delta computations clamp to `[0, max]` — safe against backwards moves or overshoot.

**Display flowing into app/services**: Display is composed into the AppLayer via `Layer.mergeAll(AppLayer, cliLayer)` in `src/index.ts`. Services that need operational logging (e.g. `index-project.ts` for scan/chunk/embed progress) use `d.updateInteractive()` or `d.log()`. Embedder GPU fallback uses `d.log(..., "warn")` — no `d.json()` calls in services; all structured output flows through the command layer.

### Flat-file storage (not SQLite)

MVP uses `.pix/` directory with JSONL + binary. No DB dependency. Reversible for Phase 3+ if incremental indexing demands it.

### Model cache in `.pix/cache/`

Self-contained per project. Offline after first download (~22 MB). Alternative: `~/.cache/huggingface/` (HF default).

### Raw source code for embedding

No AST preprocessing, no comment stripping for MVP. Code semantics depend on syntax and structure.
Future: AST-based preprocessing as optional enhancement.

### Extension opt-out via skipExtensions

Users add extensions to `skipExtensions` in `config.json` to opt out of indexing (e.g. `.pdf`, `.mp4`). The domain processor map provides the base mapping; config entries swap processors to skip. `.gitignore` provides additional filtering. Future research: `.pixignore` for project-specific exclusions.

### Context lines in chunks.jsonl

MVP stores context lines in `chunks.jsonl` at index time for instant retrieval.
Phase 3 (index freshness via mtime cache) will switch to live-fetch from source files,
removing both `text` and `context` fields from stored chunks.

### Multi-core search readiness

Search is structured for worker threads — `Effect.forEach` with concurrency parameter
used for batch processing. Single-threaded for MVP; multi-core via `worker_threads`
or `@effect/op` in Phase 3+.

### Hexagonal Architecture (DDD layers)

Domain (`src/domain/`), Application (`src/application/`), Infrastructure (`src/services/`)
with ports-as-tags and adapters-as-layers. See [ADR 0003](docs/adr/0003-hexagonal-architecture.md).

## Future Considerations

### ContentExtractor

Domain-level lookup table mapping file extensions to processing functions (`ContentExtractor`). Each processor is an `Effect<string, ProcessorError, FileSystem>` that extracts text from a file. Default processors: identity (code/text files read as-is), skip (binary/unsupported formats fail with `UnsupportedFormat`), transform (future: PDF extraction, Whisper transcription, etc.). Config allows users to add extensions to `skipExtensions` to opt out. Unknown extensions are skipped and reported at end of scan. Lives in `src/services/processors/`.

### ProcessorError

Domain error type for content extraction failures. Tagged variants: `UnsupportedFormat` (binary/unknown file type), `ExtractionFailed` (transform pipeline error). Distinct from `ChunkerError` — extraction happens before chunking.

### Chunker

Now exposes two methods: `chunkFile(file)` reads file then delegates to `chunkText(text, file)`. `chunkText(text, file)` is the pure chunking logic, called by both the identity processor and future transforms. All extraction flows through `chunkText` before embedding.

### Scanner

Returns all files found during FS walk, applying `.gitignore` rules (unless `ignoreGitignore` is true), `.git/info/exclude`, and `ignoredPaths` patterns. No extension filtering — that concern moved to `ContentExtractor`. `scanFiles(ignoredPaths, ignoreGitignore?)` applies ignore patterns during directory walk.

### Config

Replaced `files: Record<string, number>` (unused) with `skipExtensions: readonly string[]`. Users add extensions here to opt out of indexing. Domain processor map is always the base; config overrides swap entries to skip. New fields: `embedder.batchSize` (default 16), `ignoreGitignore` (default false). Updated `ignoredPaths` defaults: removed `.agents`, `.claude`, `.github`; added `.vite-hooks`, `.fallow`.

### Extension→Processor mapping (Phase 2+)

Lookup table that decides how each file extension is processed:

- **Known code extensions** (`.ts`, `.py`, `.rs`, etc.) → ContentExtractor (identity) → Chunker → Embedder (MVP behavior)
- **Known binary extensions** (`.pdf`, `.mp4`, `.jpg`, `.zip`, `.exe`, etc.) → Skip with info log; unknown/unrecognized extensions trigger a warning. Future Phase 2+ converts to text first (e.g. PDF→text extraction, MP4→Whisper transcription)
- **Future: AST preprocessing** — for languages where AST yields better embeddings than raw text
- **Future: Extension→Processor mapping** — lookup table that decides how each file extension is processed
- Incremental indexing via mtime cache or file hash (Phase 3) — `--force` flag will flip default behavior; MVP always full-reindexes
- Multi-model support (OpenAI, Mistral, OpenRouter)
- Top-K retrieval to limit result set size
- Token/character limits for chunk boundaries
- In-memory search optimization (mmap for large indexes)
- `.pixignore` as additional blacklist (research needed)
- Ranking improvements for query results
