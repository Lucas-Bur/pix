# pix — Context

## Glossary

### BM25

Lexical retrieval algorithm scoring chunks by term frequency × inverse document frequency. Corpus statistics (term frequencies, document frequencies, chunk lengths) are pre-built at index time and stored in `.pix/index.db`. Constants: k1=1.5, b=0.75 (standard Okapi BM25).

### BM25 Index

Pre-computed BM25 statistics stored as schema-validated JSON inside `.pix/index.db`: average chunk length, per-term document frequencies, per-chunk term frequencies, per-chunk lengths. Built during `pix index` and deleted on `pix reset`.

### Chunk

A piece of source code produced by the chunker. One chunk = N lines of code with overlap.
Stored as one metadata row in `.pix/index.db`. Source text remains in the source file and is loaded only for selected query results. Maximum size is guided by 60 lines (configurable `chunkLines`), with `overlapLines` lines overlapping between consecutive line chunks.
Line-chunk ID = `sha1(file:startLine).slice(0, 12)`. AST-chunk IDs also include the node's
start/end row and column so distinct declarations on one line cannot collide.
Minimum chunk size: 20 characters (configurable `minChunkChars`).

### ChunkEntry

Raw data loaded from the index and passed to scorers at query time. Contains chunk identity, exact source range, content hash, Dense vector, learned Sparse vector, and file location; no source text or context.

### Config

Runtime configuration stored in `.pix/config.json`. Contains Dense and Sparse model contracts, devices and batch sizes, Dense dtype, chunk parameters (lines, overlap, minChunkChars, concurrency), ignored paths, and skip extensions.
Structurally healed on read: missing fields are filled from `DEFAULT_CONFIG` via deep-merge. Coupled rules (model exists in registry, dtype supported by model) are validated against `ModelRegistry`. Unsupported dtypes are auto-healed to the model's `defaultDtype`; unknown models produce `ConfigHealError`.

### Embedder

Component that turns text into vectors. Uses ONNX runtime with configurable dtype (`fp32` | `fp16` | `q8` | `q4`). Default model: `Xenova/all-MiniLM-L6-v2` (384 dims).
Model cache lives in `.pix/cache/`. Batch size default: 16 (configurable). Produces `Embedding` values with `dtype` field matching the configured quantization.

### Embedding Cache

Content-addressed reuse for Dense and learned Sparse embeddings displaced from the active index. Active and historical vectors live in separate tables inside `.pix/index.db`. Dense entries are keyed by exact embedded-text hash, model, dimensions, and dtype; Sparse entries use the exact embedded-text hash and full Sparse contract. `pix cache clear` removes both histories.

### Sparse Embedder

The learned lexical-semantic encoder is required. It uses the pinned OpenSearch v3 Distill document ONNX export.
Documents produce variable `(token_id, weight)` vectors through attended max pooling and
`log1p(log1p(relu(value)))`. Queries run only the paired tokenizer; SQLite applies the persisted static
IDF table. Model artifacts live in `.pix/cache/`. Default document batch size is 2 because logits scale
with batch size × sequence length × the 30,522-token vocabulary. See ADR-0020.

### ModelRegistry

Port (`Context.Tag` in `src/domain/ports.ts`) for querying embedding model metadata: dimensions, supported dtypes, default dtype, description. `ModelRegistryLive` in `src/services/models.ts` wraps the static `MODEL_REGISTRY` record from `src/domain/models.ts`; test layers can inject a restricted fake registry to exercise coupled-validation edge cases. Two methods: `get(id) → Option<ModelInfo>` and `list() → readonly string[]`. Follows the "two adapters = real seam" principle (live + test).

### ModelInfo

Metadata for a registered embedding model: `id` (HuggingFace ID), `dims`, `dtypes` (supported quantizations), `defaultDtype` (used when healing an unsupported dtype), `description`. Lives in `src/domain/models.ts` with the static `MODEL_REGISTRY`.

### DeviceDetection

Port (`Context.Tag` in `src/domain/ports.ts`) for detecting the best available compute device for embedding inference. Two methods: `detect(model, dtype) → DeviceType` (probes devices in priority order, returns first that loads the model) and `detectAll(model, dtype) → readonly DeviceType[]` (tests each independently). The live adapter in `src/services/device-detect.ts` uses the shared generic first-working-device loader with `cuda → dml → coreml → webgpu → wasm → cpu`. Dense supplies its Feature Extraction loader, Sparse supplies its Masked-LM loader, and `BenchProject` uses `detectAll` to enumerate Dense devices. Explicit devices bypass fallback.

### Config Healing

Two-tier process that runs on every `ConfigStore.readConfig()` call:

1. **Structural heal**: deep-merge user config onto `DEFAULT_CONFIG`, then schema-decode. Missing fields are filled from defaults; bad types (`chunkLines: "sixty"`) still fail with `ConfigValidationError`.
2. **Coupled validation**: check `embedder.model` exists in `ModelRegistry` and `embedder.dtype` is in the model's `dtypes`. Unsupported dtype → auto-healed to `defaultDtype` (conflict recorded but not blocking). Unknown model → `ConfigHealError` (unhealable, blocks).

`pix config heal` is the explicit command: returns a `HealPlan`, prompts for each conflict (human mode), writes the resolved config. `--json` mode: auto-applies defaults for healed conflicts, fails with `ConfigHealError` for unhealed conflicts (agent edits config and retries). Only `pix config heal` writes config; other commands heal in memory and warn via `readConfigWithConflicts()`.

### HealConflict

A field-level conflict found during coupled validation. Shape: `{ field, currentValue, validOptions, reason, healed, healedValue? }`. `healed: true` means auto-resolved with `defaultDtype`; `healed: false` means unhealable (unknown model) — requires human/agent input.

### HealPlan

Result of `ConfigStore.healConfig()`: `{ config, conflicts }`. The `config` has all auto-fixable issues resolved; `conflicts` lists all issues found (both healed and unhealed). The `pix config heal` command uses this to prompt and write.

### ConfigHealError

`Data.TaggedError` raised when config has unhealable coupled conflicts (unknown model). Contains `conflicts` array with `field`, `currentValue`, `validOptions`, `reason` per conflict. Distinct from `ConfigValidationError` (schema decode failure) — config passed schema but failed business rules.

### InteractiveError

`Data.TaggedError` raised when `Display.select` is called without a `defaultValue` in a non-interactive context (`--json` mode). Signals that the agent needs to edit the config file directly and retry.

### ModelMismatchError

`Data.TaggedError` raised at query time when `config.embedder.model` differs from the model recorded in `.pix/index.db`. Prevents silent wrong results when config is changed without re-indexing. Contains `configModel` and `indexModel` for actionable error messages. Re-indexing resolves the mismatch.

### Scanner

Discovers files to index. Walks the project tree via `FileSystem.FileSystem`, applies `.gitignore` rules via the `ignore` package, and returns all files. Extension-based filtering is handled downstream by the ContentExtractor processor map. Configurable `ignoredPaths` patterns (gitignore-style) merged with `.gitignore` and `.git/info/exclude`. Always ignores: `.pix`, `node_modules`, `.git`, `dist`, `build`, `.next`.

### IndexStore

Owns `.pix/index.db`, which contains active chunks and Float32 Dense embedding BLOBs, learned Sparse metadata/IDF/postings, file observations, BM25, identifier postings, historical Dense and Sparse embedding caches, and Effect SQL migration history. Complete streamed replacements run in one SQLite transaction. Editable config and aliases remain files.

### Core Scope

init, incremental index, self-refreshing query, status, reset, and explicit embedding-cache clearing. No cloud providers or GUI.

### Query Routing

Evidence-based routing adjusts scorer weights before fusion using channel availability, score geometry,
term coverage, pairwise agreement, dense confidence, identifier shape, and explicit query-length bands.
Named runtime profiles use the evidence router. Compatibility is currently the only matrix-calibrated
profile: short queries (1-2 tokens) boost BM25 and reduce Dense; long queries (8+ tokens) boost Dense and
reduce BM25. The other runtime names temporarily reuse this configuration until the benchmark matrix
provides distinct values.

### Query API

Transport-independent retrieval boundary shared by CLI, saved aliases, and MCP. `QueryRequestSchema`
defines query text plus retrieval options; `runQuery()` applies shared defaults, refreshes the index,
runs hybrid retrieval, and applies the character budget. CLI-only presentation controls such as
`--json` and `--copy` stay outside this API. The CLI renders `QueryResponse`; the MCP adapter returns
the same structured response through a read-only `query` tool.

### MCP Server

`pix mcp` runs an Effect v4 MCP server over stdio. The MCP host owns its lifecycle: open stdin keeps
the process alive and EOF interrupts the server scope. The server builds indexing, SQLite, and
embedding layers once per process and serializes overlapping query tool calls with a semaphore.
SQLite remains usable from separate CLI processes; its WAL-backed connection does not hold a
permanent exclusive file lock. Its tools are `query`, `status`, `index`, `alias_list`, `alias_add`,
`alias_remove`, and `alias_run`; reset, cache clearing, initialization, and config healing remain
CLI-only.

### Query Alias

Named query-only preset stored in `.pix/aliases.json` as a flat map keyed by alias name. Each value contains `queryText` plus query options (`top`, `ignorePath`, `onlyPath`, `contextLines`, `maxCharacters`, `noContent`, and `profile`). Output modes such as JSON and Clipboard Copy are runtime choices, not part of the alias. `pix run <name>` is the short form for `pix alias run <name>`; both execute the same implementation.

### Clipboard Copy

Runtime output mode that copies all returned query results to the system clipboard without changing search semantics.

### RankedChunk

Scorer output — ranks all chunks against a query. Shape: `{ chunkIndex: number, score: number }[]` sorted by score descending. Each scorer returns its own ranked list; RRF fuses N lists by rank position.

### RRF (Reciprocal Rank Fusion)

Fuses N ranked lists by rank position: `Σ weight * 1 / (k + rank_in_path)`. Raw scores are discarded — only rank position matters. k=60 (standard, configurable later). Pure function in `src/lib/retrieval/rrf.ts`.

### Fusion Strategy and Optimization Profiles

Production currently uses DBSF as the compatibility fusion for the five live channels. The schema-20
`search-priority` full benchmark selected DBSF over Relative Score for the current rollout: fit-all R@5
was `80.7%` versus `68.7%`, and fit-all Context@4k was `81.3%` versus `73.3%`; broader matrix validation
remains benchmark follow-up. RRF remains available as an explicit historical diagnostic and rollback
comparison. The
production seam is an explicit fusion method plus an evidence router, so Identity, CamelCase, BM25,
Dense, and the learned Sparse channel participate without fusion-specific channel branches. The router
may adjust each channel's base weight using score separation, score geometry, term coverage, pairwise
agreement, dense confidence, identifier likelihood, query length, and channel availability.
The promoted full configuration, including its `dbsf` fusion method, is
`PROMOTED_SEARCH_PRIORITY_CONFIG` in `src/domain/retrieval.ts`; `PRODUCTION_COMPATIBILITY_CONFIG` is a
direct alias. Named runtime profiles are registered in `PRODUCTION_PROFILES`; profiles without
matrix-derived values temporarily reuse the compatibility configuration and are marked experimental.

The benchmark's default `search-priority` profile weights the four authored query forms as
intent-weighted: `identifier=1`, `agentTask=2`, `naturalQuestion=3`, and `searchPhrase=4`, while still
reporting unweighted per-form results and holdout guardrails. This is an evaluation objective, not an
implicit runtime query label. Benchmark-only profiles such as `balanced`, `code-navigation`, and
`basic-exploration` may choose different query-form priorities, channel priors, and target metrics
(Recall@5/10/20/50 and context recall). See ADR-0019, issue #162 for production Sparse, and issue #163
for evidence-based fusion and optimization profiles.

Production queries accept the named profile selection `compatibility`, `balanced`, `code-navigation`, or
`natural-language`. Only `compatibility` currently has matrix-derived values; the remaining names are
runtime placeholders until their configurations are selected from the benchmark matrix.

Benchmark-owned profile seeds and optimizer search live under `benchmarks/retrieval/`; current profile
values are marked `authored-seed` and are not presented as benchmark-derived weights. Production keeps
only the active router configuration and reusable fusion/evidence seams. A benchmark result is promoted
explicitly rather than making the production package responsible for discovering its own profile.

### Retrieval Quality Benchmark

Opt-in local suite under `benchmarks/` that imports pix chunking, identifier extraction, scorers,
query routing, RRF, and embedders directly. It is not a product CLI command and does not run in CI.
Pinned FastAPI, Effect v4, and fd corpora contain exact file-qualified gold symbols. The suite reports
Recall@5/10/20/50, Success@10/20, MRR, and context recall at fixed estimated-token budgets for individual
channels, all 15 channel subsets, weight grids, and all registered embedding models. Every intent has
identifier, search-phrase, natural-question, and agent-task representations which remain grouped in
five-fold validation after a deterministic per-repository shuffle and category/difficulty-stratified assignment. Leave-one-repository-out tests cross-codebase generalization; exact holdout
Shapley values explain marginal channel contribution. Embedders use automatic device selection and a
maximum batch size of two. Schema 7 also compares Weighted RRF, per-channel min-max relative-score
fusion, and three-sigma distribution-based score fusion with independently tuned positive weights,
then evaluates one evidence-based router across all query forms.
Schema-7 benchmark profiles trade runtime for coverage without changing retrieval semantics: `smoke`
uses fd and MiniLM, `develop` uses all corpora with MiniLM and grouped 3-fold, `validate` adds grouped
5-fold and repository holdouts, and `full` restores every fusion diagnostic for one selected model.
Schema 8 keeps the schema-5 linear router and its existing signals but applies its dynamic weights
through DBSF. Static and dynamic holdout columns therefore use the same score-fusion formula; the
artifact records that formula explicitly.
Schema 9 adds a composite score-geometry confidence signal to that linear router. It uses normalized
top-score gaps, score-curve area, plateau width, entropy, and effective candidate count. The `full`
profile evaluates the resulting router with RRF, relative-score, and DBSF while smaller profiles stay
on DBSF.
Schema 10 adds query-term coverage signals: BM25 IDF-weighted coverage, exact full-identifier
coverage, and CamelCase component coverage. These are mapped to their corresponding lexical channels;
dense receives a neutral value. Schema-10 artifacts include the two active fusion methods and fit-all
preview metrics in addition to grouped and repository holdouts.
Schema 11 replaces aggregate cross-channel agreement with symmetric pairwise agreement for all six
channel pairs at K=5, 10, and 20, evaluated with the active Relative Score and DBSF fusions.
Schema 12 adds dense confidence from the dense score distribution using top-score/median separation,
MAD-based robust deviation, and score-tail strength. Model- and repository-specific calibration is
not yet part of the router. The full milestone runs MiniLM and BGE separately with all three fusion
methods; model quality and cost are compared from the same pinned corpora and hold-out splits.
Schema 13 adds aggregate Recall@5 to quality summaries and reports and makes grouped intent-fold
assignment independent of manifest question order through a fixed-seed category/difficulty-stratified shuffle.
Short-profile fusion runs use Relative Score and DBSF; the full profile also runs RRF for milestone
comparisons.
Schema 14 records the router search strategy and compute-time breakdown in each artifact, including
corpus preparation, embedding, retrieval, static fusion search, and evidence-router search duration.
Schema 15 adds deterministic one-stage proxy promotion to the evidence-router search. The benchmark evaluates the
current production router as an explicit holdout baseline, adds Recall@50, and uses one
shared Pareto search to select objective-specific candidates for direct retrieval, reranker top-20
candidate pools, and reranker top-50 candidate pools. Each candidate must remain within a 1% development
guardrail of the current Production router; grouped and leave-one-repository-out holdouts determine whether the
objective-specific candidates generalize. The three objectives are reported separately because direct
R@5 quality and reranker candidate-pool R@50 quality are different deployment goals.
Schema 17 (historical) adds a benchmark-only OpenSearch Distill sparse channel. It uses the verified ONNX document
export with max-pooled positive token logits and a matching static IDF query lookup; variable-length
document vectors are cached separately under `benchmarks/.cache/sparse`. Sparse-inclusive rankings,
five-channel score fusion, ten pairwise agreement signals, and separate sparse timing rows are recorded
in schema-17 artifacts. ADR-0020 promotes the validated Sparse contract to the production five-channel
fusion path and persists its IDF and postings in `.pix/index.db`.
Schema 19 removes the benchmark-owned Sparse encoder, in-process postings implementation, and separate
embedding caches. Benchmark profile fitting and optimizer search remain benchmark-owned, while the
fusion adapters and evidence signals are shared with production. Benchmarks
compose the production SparseEmbedder and IndexStore around a migrated in-memory SQLite database;
Dense and Sparse ranking therefore execute through the same adapters as product queries. Experimental
profile fitting remains benchmark-owned. Every artifact includes the authored file-qualified ground truth and
both the current Production router and a fixed five-channel `1/1/1/1/1` historical RRF baseline. Channel combinations
and leave-one-channel-out variants use equal weights so channel contribution is not confounded by routing.
New repositories are represented by JSON manifests in `benchmarks/corpus/`, selected with
`PIX_BENCH_REPOS`, and cached under `benchmarks/.cache/repos/`.
The router uses only runtime-observable query length and identifier shape, within-channel score
separation, channel availability, and cross-channel rank agreement. Raw scores from different
channels are never compared. A deterministic coarse-to-fine beam search starts with 64 Halton global
scout points, then refines positive dynamic base weights (minimum 0.1) and per-channel
score/agreement coefficients in 0.1 steps; signed per-channel query slopes allow the same
length or identifier signal to boost one channel and damp another. Each coordinate sweep retains the
current beam elites, so a later coordinate cannot regress the best development candidate. Its parameters are selected on
development folds and evaluated unchanged against static weights on excluded intent folds and
repositories; authored query-form labels remain informed reference strata and are not router inputs.
This router remains benchmark-only until holdouts justify a production change.
Repository checkouts live under ignored `benchmarks/.cache/repos/`; generated artifacts live under
ignored `benchmarks/results/`. Dense and Sparse vectors are held only in the production in-memory
SQLite adapter during a benchmark run. See `benchmarks/README.md` and `benchmarks/BASELINE.md`.

### Scorer

A retrieval path producing `RankedChunk[]`. BM25 and identifier scorers are pure functions over pre-built data. Dense ranking runs in SQLite through sqlite-vector; learned Sparse ranking runs in SQLite through indexed IDF/posting joins. SQLite is the sole implementation for both persisted-vector channels.

### Scorer Weight

Multiplier applied to a scorer's RRF contribution, set by query routing. Dialogs a retrieval path's influence up or down based on query characteristics. Not a normalization factor — RRF rank positions are already comparable across paths.

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

`Context.Tag("Display")` in `src/domain/ports.ts`. Abstracts all CLI output behind structured methods. Commands and services use `yield* Display` — never `Console.log` or `Effect.logInfo` directly. Implementations in `src/display/`: `clack-display.ts`, `json-display.ts`, `silent-display.ts`. Entry types in `entries.ts`.

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

**`d.select(message, options, defaultValue?)`**: Interactive selection prompt. Returns the chosen value. In `ClackDisplay`, renders via `clack.select` with `initialValue`. In `JsonDisplay`, returns `defaultValue` silently if provided; throws `InteractiveError` if not (agent must edit config and retry). In `SilentDisplay`, records `DisplayEntry.select` and returns `selectValue` (test override), `defaultValue`, or throws `InteractiveError`. Used by `pix config heal` for conflict resolution.

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

Zero-vector Dense Embedder and empty-vector Sparse Embedder provided by `testLayer()`. Used in Use Case and Command tests where model inference is irrelevant to the assertion.

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

A `Context.Tag` interface in `src/domain/ports.ts` declaring what the application needs — no implementation, no I/O. Examples: `ConfigStore`, `Scanner`, `ContentExtractor`, `Chunker`, `Embedder`, `IndexStore`, `Display`.

### Adapter

A concrete implementation of a port, living in `src/services/`. Each adapter is an `Effect.Layer`. Example: `OnnxEmbedderLive` provides `Embedder`; `IndexStoreLive` provides `IndexStore`.

### Domain Layer (`src/domain/`)

Pure TypeScript types — no Effect, no I/O. Entities (`Config`, `Chunk`), value objects (`Embedding` with `dtype: EmbeddingDtype`), error types (`ConfigError`), and port declarations.

### Application Layer (`src/application/`)

Use cases as `Effect.Service` classes. Orchestration only — declares port dependencies via `yield*`, never touches files or ONNX directly. Examples: `InitProject`, `IndexProject`, `QueryProject`, `GetStatus`.

### Infrastructure Layer (`src/services/`)

Concrete adapters implementing domain ports. Reads/writes files, runs ONNX models, shells out. Each provides an `Effect.Layer` for its port tag.

### Use Case

A single business operation in the application layer. Depends on ports via Effect tags. Testable with mock adapters.

### Composition Root (`src/index.ts`)

Single entry point that wires all layers: infrastructure → chunker → application → CLI. All dependencies satisfied in one place.

### CLI Commands

- `pix init` — Create `.pix/config.json`. Prompts for model selection (human mode); `--json` uses default model.
- `pix index` — Incrementally refresh the index. Unchanged files reuse chunk metadata, vectors, BM25 terms, and identifier postings; changed chunks use the embedding cache before inference.
- `pix query "<text>" [--top N] [--json] [--context-lines N] [--ignore-path P] [--only-path P] [--max-characters N] [--no-content] [--profile compatibility|balanced|code-navigation|natural-language]` — Ensure the index is fresh, then run hybrid search. Missing indexes, source changes, and model/dtype changes are repaired automatically. Source text loads only after top-K selection; `compatibility` is the matrix-calibrated runtime configuration and the other named profiles currently reuse it.
- `pix mcp` — Run the host-managed MCP stdio server exposing the shared read-only query API.
- `pix status` — Show index statistics
- `pix reset` — Delete the active SQLite index snapshot while retaining historical embeddings
- `pix cache clear` — Delete the content-addressed embedding cache.
- `pix config heal` — Validate and repair `.pix/config.json`. Structural heal (fill missing fields from defaults) + coupled validation (model registry check). Prompts for each conflict in human mode; `--json` mode auto-applies defaults for healed conflicts, fails with `ConfigHealError` for unhealed conflicts.

All one-shot commands support `--json` for agent-ready structured output on stdout. Single JSON object emitted at end of successful operations (e.g. `{ chunks, files, totalLines, byteSize, durationMs }`). Error output uses `reportError` which calls both `d.log(..., "error")` (human) and `d.json(error)` (agent).

## Relationships

- A **Scorer** consumes **ChunkEntry** data and produces a **RankedChunk** list
- **RRF** fuses N **RankedChunk** lists, each weighted by **Query Routing** output
- Production currently selects the promoted DBSF evidence-router configuration; RRF remains an explicit
  historical benchmark and rollback baseline
- **BM25 Index** is built once by the index pipeline, consumed by the BM25 **Scorer** at query time
- Retrieval channels expose `RankedChunk[]` through the production fusion seam. BM25 and identifiers
  score in pure functions; Dense and Sparse rank natively through `IndexStore`.

## Architecture Decisions

### Display service with JSON mode switching

CLI output goes through a `Display` context tag (`src/domain/ports.ts`). Two production implementations selectable by `--json`: `ClackDisplay` (`src/display/clack-display.ts`, interactive, uses `@clack/prompts` for spinners, styled status, frames) and `JsonDisplay` (`src/display/json-display.ts`, machine-readable, no-ops interactive methods, writes JSON to stdout). A third implementation (`SilentDisplay`, `src/display/silent-display.ts`) records calls to a `Ref<DisplayEntry[]>` for test assertions. Entry types defined in `src/display/entries.ts`.

**Output separation**: `ClackDisplay.json` is a no-op — structured output never appears in human mode. `JsonDisplay` no-ops all interactive methods. Each Display handles its own surface. Commands call all methods unconditionally; no `if (!json)` branching. Error output uses `reportError` which calls both `d.log(..., "error")` (human) and `d.json(error)` (agent) — ClackDisplay renders the log, JsonDisplay emits the JSON.

**Interactive constraints**: Only one interactive line (spinner or progress bar) at a time. `d.updateInteractive(msg)` calls `s.message(msg)` on the active spinner or computes delta + calls `b.advance(delta, msg)` on the active progress bar. `d.progress()` stops any active spinner before starting the progress bar.

For spinners, text updates are sufficient visual feedback. For progress bars, `d.updateInteractive()` supports three position controls via discriminated union:

- `advanceBy: N` — advance the bar by N steps relative to current position
- `setTo: N` — jump to absolute position N (clamped to `[0, max]`)
- `setToPercent: P` — jump to P% of max (clamped to `[0, 100]`)

Position state is tracked locally (`state: { value, max }`) since `@clack` only exposes `advance(step)`. All delta computations clamp to `[0, max]` — safe against backwards moves or overshoot.

**Display flowing into app/services**: Display is composed into the AppLayer via `Layer.mergeAll(AppLayer, cliLayer)` in `src/index.ts`. Services that need operational logging (e.g. `index-project.ts` for scan/chunk/embed progress) use `d.updateInteractive()` or `d.log()`. Embedder GPU fallback uses `d.log(..., "warn")` — no `d.json()` calls in services; all structured output flows through the command layer.

### SQLite index storage

Generated index state lives in `.pix/index.db` and evolves through Effect SQL migrations. Ordinary tables hold Float32 embedding BLOBs; sqlite-vector performs exact or optional TurboQuant cosine scans. See ADR-0018.

### Model cache in `.pix/cache/`

Self-contained per project. Offline after first download (~22 MB). Alternative: `~/.cache/huggingface/` (HF default).

### Raw source code for embedding

No AST preprocessing, no comment stripping for MVP. Code semantics depend on syntax and structure.
Future: AST-based preprocessing as optional enhancement.

### Extension opt-out via skipExtensions

Users add extensions to `skipExtensions` in `config.json` to opt out of indexing (e.g. `.pdf`, `.mp4`). The domain processor map provides the base mapping; config entries swap processors to skip. `.gitignore` provides additional filtering. Future research: `.pixignore` for project-specific exclusions.

### Lazy source text and context

SQLite stores no source text or context. Query ranks persisted metadata first, then reads exact source offsets and requested context only for selected top-K results. The chunk content hash verifies that displayed source produced the ranked embedding. See ADR-0017.

### Multi-core search readiness

Search is structured for worker threads — `Effect.forEach` with concurrency parameter
used for batch processing. Single-threaded for MVP; multi-core via `worker_threads`
or `@effect/op` in Phase 3+.

### Hexagonal Architecture (DDD layers)

Domain (`src/domain/`), Application (`src/application/`), Infrastructure (`src/services/`)
with ports-as-tags and adapters-as-layers. See [ADR 0003](docs/adr/0003-hexagonal-architecture.md).

## Future Considerations

### ContentExtractor

Domain-level lookup table mapping file extensions to processing functions (`ContentExtractor`). Each processor is an `Effect<string, ProcessorError, FileSystem>` that extracts text from a file. Default processors: identity (code/text files read as-is), skip (binary/unsupported formats fail with `UnsupportedFormat`), transform (future: PDF extraction, Whisper transcription, etc.). Config allows users to add extensions to `skipExtensions` to opt out. Unknown extensions are skipped and reported at end of scan. Lives in `src/lib/config/processors.ts`.

### ProcessorError

Domain error type for content extraction failures. Tagged variants: `UnsupportedFormat` (binary/unknown file type), `ExtractionFailed` (transform pipeline error). Distinct from `ChunkerError` — extraction happens before chunking.

### Chunker

`chunkText(text, file)` resolves the file extension through the shared extension registry. TypeScript,
JavaScript, TSX, JSX, Python, and Rust use tree-sitter top-level AST nodes as indivisible semantic units, greedily packed into chunks spanning at most `chunkLines`. A single larger node remains whole.
Parserless extensions and malformed ASTs fall back to the configured line chunker. AST parsing is a
best-effort optimization: foreign parser failures are normalized internally and never skip indexable text.

### Scanner

Returns all files found during FS walk, applying `.gitignore` rules (unless `ignoreGitignore` is true), `.git/info/exclude`, and `ignoredPaths` patterns. No extension filtering — that concern moved to `ContentExtractor`. `scanFiles(ignoredPaths, ignoreGitignore?)` applies ignore patterns during directory walk.

### Config

Replaced `files: Record<string, number>` (unused) with `skipExtensions: readonly string[]`. Users add extensions here to opt out of indexing. Domain processor map is always the base; config overrides swap entries to skip. Fields include `embedder.batchSize` (default 16), the pinned `sparseEmbedder` model/query contracts with document batch size 2, `ignoreGitignore` (default false), and `vectorSearch` (`mode`: exact/auto/turboquant; `turboQuantThreshold`: default 50000). Updated `ignoredPaths` defaults: removed `.agents`, `.github`; added `.vite-hooks`, `.fallow`.

### Extension→Processor mapping (Phase 2+)

Lookup table that decides how each file extension is processed:

- **Known code extensions** (`.ts`, `.py`, `.rs`, etc.) → ContentExtractor (identity) → Chunker → Embedder (MVP behavior)
- **Known binary extensions** (`.pdf`, `.mp4`, `.jpg`, `.zip`, `.exe`, etc.) → Skip with info log; unknown/unrecognized extensions trigger a warning. Future Phase 2+ converts to text first (e.g. PDF→text extraction, MP4→Whisper transcription)
- **Future: AST preprocessing** — for languages where AST yields better embeddings than raw text
- **Future: Extension→Processor mapping** — lookup table that decides how each file extension is processed
- Multi-model support (OpenAI, Mistral, OpenRouter)
- Top-K retrieval to limit result set size
- Token/character limits for chunk boundaries
- In-memory search optimization (mmap for large indexes)
- `.pixignore` as additional blacklist (research needed)
- Ranking improvements for query results
- Structured query history in `.pix/history.jsonl` for future alias recommendations. Each entry could record timestamp, query text, options, duration, and result metadata so a future LLM workflow can suggest useful **Query Alias** candidates.
