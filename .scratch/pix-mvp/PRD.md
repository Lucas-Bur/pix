# PRD: pix MVP — Lightweight Local Semantic Project Indexer

Status: needs-triage

## Problem Statement

Developers need a lightweight, local-only tool to semantically index their project's source code so that AI agents and humans can query the codebase using natural language. Existing solutions require cloud services, Docker, or heavy infrastructure. There is no zero-dependency, offline-capable tool that installs as a simple devDependency and provides agent-ready structured output.

## Solution

Build `@lucas-bur/pix`, a CLI tool that:
1. Scans the project for source files (gitignore-aware, extension whitelist)
2. Chunks source code into overlapping line-based windows
3. Embeds chunks locally using an ONNX model (no cloud, no API keys)
4. Stores the index in flat files (`.pix/` directory)
5. Provides semantic search via cosine similarity
6. Outputs structured JSON on stdout for agent piping

The tool is built with the Effect ecosystem for typed errors and structured concurrency, uses `@huggingface/transformers` for local embeddings, and is bundled with `vite-plus` (`vp pack`).

## User Stories

### Project Setup
1. As a developer, I want to run `pix init` to create a `.pix/config.json` with default settings, so that I can customize indexing behavior.
2. As a developer, I want `pix init` to remind me to add `.pix` to `.gitignore`, so that the index is not committed to version control.
3. As a developer, I want the config to store chunk parameters (chunkLines, overlapLines), model name, and dimensions, so that re-indexing uses consistent settings.

### Indexing
4. As a developer, I want to run `pix index` to scan, chunk, embed, and store my project's source code, so that I can later query it semantically.
5. As a developer, I want `pix index` to respect `.gitignore` rules, so that build artifacts and dependencies are not indexed.
6. As a developer, I want `pix index` to only index files matching a configurable extension whitelist, so that binary and irrelevant files are skipped.
7. As a developer, I want `pix index --force` to re-index all files regardless of mtime cache, so that I can refresh the index after changing chunk parameters.
8. As a developer, I want `pix index --verbose` to show progress per batch, so that I can monitor long-running index operations.
9. As a developer, I want the embedding model to be downloaded once to `.pix/cache/`, so that subsequent runs work offline.
10. As a developer, I want `pix index` to chunk files using a sliding window (60 lines with 10 line overlap), so that code context is preserved across chunk boundaries.
11. As a developer, I want chunks smaller than 20 characters to be skipped, so that meaningless chunks don't pollute the index.
12. As a developer, I want chunks to be embedded in batches of 16 with concurrency 1 (ONNX single-threaded), so that the system remains stable during embedding.
13. As a developer, I want `chunks.jsonl` and `vectors.bin` to be overwritten atomically on each index run, so that a failed run doesn't corrupt the index.

### Querying
14. As a developer, I want to run `pix query "authentication middleware"` to find semantically relevant code snippets, so that I can quickly locate relevant code.
15. As a developer, I want `pix query` to use cosine similarity in-memory, so that queries are fast without requiring a vector database.
16. As a developer, I want `pix query --top N` to limit results to N items, so that I can control the output size on large codebases.
17. As a developer, I want `pix query --context-lines N` to include N lines of context before and after each match, so that I get more surrounding code for understanding.
18. As a developer, I want query results to include file path, start line, end line, relevance score, and code text, so that I can locate and understand the matched code.

### Status & Reset
19. As a developer, I want to run `pix status` to see index statistics (chunk count, file count, model name, last index time), so that I know the state of my index.
20. As a developer, I want to run `pix reset` to delete `chunks.jsonl` and `vectors.bin` while keeping `config.json`, so that I can start fresh without reconfiguring.

### Agent-Ready Output
21. As an AI agent, I want all `pix` commands to support `--json` flag, so that I can parse structured output programmatically.
22. As an AI agent, I want `pix status --json` to output JSON with chunk count, file count, model, and last index time, so that I can decide whether to re-index.
23. As an AI agent, I want `pix query --json` to output a JSON array of results, so that I can process search results in my workflow.
24. As an AI agent, I want `pix index --json` to output final JSON with chunk count, file count, and duration, so that I can confirm successful indexing.
25. As an AI agent, I want error responses in JSON format with `error`, `code`, and `message` fields, so that I can handle failures programmatically.

### Quality & Developer Experience
26. As a developer, I want `fallow` to run as a quality gate after type-checking and tests, so that dead code, duplication, and complexity are detected.
27. As a developer, I want all modules to have co-located test files, so that tests are easy to find and maintain.
28. As a developer, I want the project to use TDD (red-green-refactor) for all modules, so that the code is well-tested and reliable.
29. As a developer, I want the CLI to be built with `@effect/cli` and Effect runtime, so that I learn Effect and have a solid foundation for future growth.
30. As a developer, I want the build to use `vp pack` (vite-plus), so that the CLI is properly bundled as an ESM executable.

## Implementation Decisions

### Modules to Build (Pipeline Order)
- **`src/types.ts`** — Shared types: `Chunk`, `Config`, extension whitelist constants. `Chunk` matches `chunks.jsonl` schema. `Config` matches `config.json` schema.
- **`src/services/scanner.ts`** — File discovery using `fast-glob` + `ignore`. Whitelist extensions from config. Always ignores `.pix`, `node_modules`, `.git`, `dist`, `build`, `.next`.
- **`src/services/chunker.ts`** — Line-based sliding window. Configurable `chunkLines` (default 60) and `overlapLines` (default 10). Skip chunks < 20 chars. Chunk-ID = `sha1(file:startLine).slice(0, 12)`.
- **`src/services/embedder.ts`** — ONNX embeddings via `@huggingface/transformers`. Model: `Xenova/all-MiniLM-L6-v2`, dtype: `q8`, device: `cpu`. Model cache in `.pix/cache/`. Batch size configurable (default 16). Interface: `embed(texts: string[]): Promise<Float32Array[]>`. Mock embedder for unit tests.
- **`src/services/store.ts`** — Read/write `.pix/config.json`, `chunks.jsonl`, `vectors.bin`. `vectors.bin` = flat `Float32Array`, row-major, `n × 384` floats.
- **`src/commands/init.ts`** — `pix init` implementation.
- **`src/commands/index-cmd.ts`** — `pix index [--force] [--verbose]` implementation. Pipeline: read config → scan → chunk (parallel, concurrency: inherit) → embed (serial batches, concurrency: 1) → store.
- **`src/commands/query.ts`** — `pix query "<text>" [--top N] [--json] [--context-lines N]`. Cosine similarity in-memory. Context before/after via file read.
- **`src/commands/status.ts`** — `pix status` implementation.
- **`src/commands/reset.ts`** — `pix reset` implementation.
- **`src/index.ts`** — CLI entry point with `@effect/cli` Command definitions.

### Key Technical Decisions
- Flat-file storage (`.pix/` directory) — no database for MVP, reversible for Phase 3+
- Model cache in `.pix/cache/` (not `~/.cache/huggingface/`) — self-contained per project
- Raw source code for embedding — no AST preprocessing for MVP
- Whitelist extension filtering via `config.json` — no `.pixignore` for MVP
- `.gitignore` filtering via `ignore` package
- All commands support `--json` for agent-ready structured output
- `fallow` as quality gate (npm script + optional pre-commit hook)
- Build with `vp pack` (vite-plus/rolldown), not `tsc`
- Co-located test files for each module

## Testing Decisions

- All modules will be built using TDD (red-green-refactor) via the `/tdd` skill
- Test external behavior, not implementation details
- Mock embedder for `embedder.ts` unit tests (deterministic dummy vectors, same format as real embedder)
- Integration test for real ONNX embedding as separate `test:integration` script
- Co-located test files: `scanner.ts` + `scanner.test.ts`, etc.
- `fallow --format json` as quality gate after type-checking and tests
- Prior art: The project uses Effect testing patterns; follow existing conventions in the codebase

## Out of Scope (MVP)

- Incremental indexing / file-watch (Phase 2/3)
- Move/delete tracking (Phase 3)
- GUI
- Cloud embedding providers (OpenAI, Mistral, OpenRouter) — Future
- AST-based preprocessing for improved embedding — Future
- Token/character limits for chunk boundaries — Future
- In-memory search optimization (mmap for large indexes) — Future
- `.pixignore` as additional blacklist — Future research
- Ranking improvements for query results — Future
- Top-K retrieval to limit result set size — Future
- Multi-model support via provider abstraction — Future

## Further Notes

- The project is a learning vehicle for the Effect ecosystem (typed errors, structured concurrency)
- `pix query` was moved from Phase 2 to MVP during the grill-with-docs session
- Context documented in `CONTEXT.md` with glossary, architecture decisions, and future considerations
- Roadmap phases: MVP (this PRD) → Phase 2 (query enhancements) → Phase 3 (incremental indexing) → Phase 4 (agent skill file)
- The binary should run under both `npm run`, `npx`, and `bunx`
- Bun compatibility: `@huggingface/transformers` v4.2.0 runs stable under Bun ≥ 1.0; known issue: `bun test` + onnxruntime may crash (Bun bug)
