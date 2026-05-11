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

Discovers files to index. Uses `fast-glob` + `ignore` for `.gitignore`-aware scanning.
Whitelist of file extensions in `config.json` (e.g. `.ts`, `.py`, `.rs`). Only text/code extensions — binary formats (`.pdf`, `.mp4`, etc.) are excluded by design.
Always ignores: `.pix`, `node_modules`, `.git`, `dist`, `build`, `.next`.

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

### Agent-ready

Structured JSON output on stdout (not stderr). Enables piping between `pix` and AI agents.

### CI (Continuous Integration)

Automated quality pipeline on PR to `main`: format + lint + type-check + test + build.
Fallow audit runs non-blocking for metrics. See [ADR 0004](docs/adr/0004-ci-cd-pipeline.md).

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
- `pix index` — Scan, chunk, embed, store (full re-index; `--force` flag reserved for Phase 3)
- `pix query "<text>" [--top N] [--json] [--context-lines N]` — Semantic search via cosine similarity
- `pix status` — Show index statistics
- `pix reset` — Delete `chunks.jsonl` + `vectors.bin`

All commands support `--json` for agent-ready structured output on stdout.

## Architecture Decisions

### Flat-file storage (not SQLite)

MVP uses `.pix/` directory with JSONL + binary. No DB dependency. Reversible for Phase 3+ if incremental indexing demands it.

### Model cache in `.pix/cache/`

Self-contained per project. Offline after first download (~22 MB). Alternative: `~/.cache/huggingface/` (HF default).

### Raw source code for embedding

No AST preprocessing, no comment stripping for MVP. Code semantics depend on syntax and structure.
Future: AST-based preprocessing as optional enhancement.

### Whitelist extensions (not blacklist)

Extensions like `.ts`, `.py` must be explicitly listed in `config.json`.
`.gitignore` provides additional filtering. Future research: `.pixignore` for project-specific exclusions.

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

- Extension→Processor mapping (Phase 2+) — lookup table that decides how each file extension is processed:
  - **Known code extensions** (`.ts`, `.py`, `.rs`, etc.) → Chunker → Embedder (MVP behavior)
  - **Known binary extensions** (`.pdf`, `.mp4`, `.jpg`, `.zip`, `.exe`, etc.) → Skip with warning log. Future Phase 2+ converts to text first (e.g. PDF→text extraction, MP4→Whisper transcription)
  - **Future: AST preprocessing** — for languages where AST yields better embeddings than raw text
- Incremental indexing via mtime cache or file hash (Phase 3) — `--force` flag will flip default behavior; MVP always full-reindexes
- Multi-model support (OpenAI, Mistral, OpenRouter)
- Top-K retrieval to limit result set size
- Token/character limits for chunk boundaries
- In-memory search optimization (mmap for large indexes)
- `.pixignore` as additional blacklist (research needed)
- Ranking improvements for query results
- **CLI printing overhaul** — replace `console.log` with clack/chalk or similar Effect-compatible library
