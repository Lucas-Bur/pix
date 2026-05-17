# Refactoring Backlog

> Generated: 2026-05-17
> Goal: Reduce duplication, deepen shallow modules, improve DX, enforce Effect best practices, prepare codebase for multi-dtype embeddings.
> Process: One candidate at a time → implement → critique → quality gate → commit → next.

## Architecture Philosophy (Read Before Every Step)

This project follows **hexagonal architecture** with three DDD layers: domain (`src/domain/`), application (`src/application/`), infrastructure (`src/services/`). Use the vocabulary from [LANGUAGE.md](../.agents/skills/improve-codebase-architecture/LANGUAGE.md) consistently:

- **Module** — anything with an interface and implementation
- **Interface** — everything a caller must know: types, invariants, error modes, ordering, config
- **Seam** — where an interface lives; a place behaviour can be altered without editing in place
- **Adapter** — a concrete thing satisfying an interface at a seam
- **Depth** — leverage at the interface: a lot of behaviour behind a small interface
- **Locality** — what maintainers get from depth: change, bugs, knowledge concentrated in one place

**Key principles:**

- **Deletion test**: imagine deleting the module. If complexity vanishes, it was a pass-through. If complexity reappears across N callers, it was earning its keep.
- **The interface is the test surface.** Callers and tests cross the same seam.
- **One adapter = hypothetical seam. Two adapters = real seam.** Don't introduce a seam unless something actually varies across it.
- **If code is referenced from 2+ files → `src/lib/`. Otherwise stays internal.**

**Effect best practices:**

- NEVER use `Effect.log*` — errors must flow through return types or the error channel
- Bound consumption of streams — infinite streams hang on `Stream.runCollect()`
- `Ref.update` is sequential — mutating in place is fine when no concurrency
- Layer composition: declare dependencies, let caller provide (don't bake them in)
- Use `Data.TaggedError` for domain errors, `catchTags` for known errors, `catchAll` as safety net

**Quality gates after every step:**

1. `vp check` — format, lint, type check. Fix with `vp check --fix`.
2. `vp test` — all tests must pass.
3. `vp run lint:fallow` — no new duplication, no dead code, no complexity regressions.

---

## Step 2: Test Infrastructure Cleanup

**Files:** All command test files, `src/display/Display.test.ts`, `tests/test-utils/`

**Reason:** Every command test file repeats the same boilerplate: `Command.run` wrapper (5 copies), `silentDisplay()` setup (27 occurrences), `makeFailing*` factories with identical structural patterns, config JSON fixtures duplicated 4+ times. This makes adding new tests tedious and creates maintenance drag — when the test utility API changes, every test file must be updated.

**Changes:**

- Extract `runCommand(command, args)` utility in `tests/test-utils/command.ts` → eliminate 5 duplicated `Command.run` wrappers in test files
- Delete `Display.test.ts:setup()` (lines 8-12) → import `silentDisplay` from `tests/test-utils/silentDisplay.js`
- Delete `emptyScannerLayer` in `index-cmd.command.test.ts` (lines 22-24) → it duplicates `defaultScannerLayer` in `testLayer.ts` (lines 28-31). Use `testLayer`'s default instead.
- Move `makeChunk` and `makeEmbedding` factories from `vector-store.test.ts` to `tests/test-utils/fixtures.ts` so they're shared
- Extract `expectLogEntry(ref, opts: { severity?, messageIncludes? })` helper in `tests/test-utils/command.ts` for the repeated warning/error assertion pattern (`entries.some(e => e._tag === "log" && e.severity === "warn" && e.message.includes("..."))`)
- Consolidate config JSON fixture into shared constant `TEST_CONFIG` in `fixtures.ts` (currently duplicated in `command.ts`, `query.command.test.ts`, `reset.command.test.ts`, `index-cmd.command.test.ts`)

**Risk:** Low — test-only changes, no production code affected.

**Depth consideration:** The test utilities themselves should be deep — small interface, lots of behavior. `testLayer()` is already deep (60 LOC, 11 fan-in). The new `runCommand` and `expectLogEntry` should be similarly deep: one-liner call sites, all complexity hidden inside.

---

## Step 3: Extract FsErrorMapper + Display Dedup

**Files:** `src/services/vector-store.ts`, `src/services/config-store.ts`, `src/display/Display.ts`

**Reason:** The pattern of mapping `@effect/platform` FileSystem errors to domain errors (`StoreError`, `DiskFullError`, `DisplayLogError`) is duplicated between `vector-store.ts` (lines 107-146: `toStoreError`, `toReadError`, `withStoreError`, `withReadError`, `ensureDirExists`) and `config-store.ts` (lines 21-34: `mapConfigWriteError`). Both check `isPlatformReason(cause, "BadResource")` → `DiskFullError`, else → generic error. This is the same seam with two identical adapters — extract to `lib/`.

Similarly, `ClackDisplay.json()` and `JsonDisplay.json()` are byte-identical (4 lines each):

```typescript
appendLogEntry(fs, { type: "json" }).pipe(
  Effect.andThen(Effect.sync(() => process.stdout.write(`${JSON.stringify(data)}\n`))),
)
```

Copy-paste duplication that will drift when someone changes one and forgets the other.

**Changes:**

- Create `src/lib/fs-error.ts` with:
  - `toFsError(operation, path?)` — maps platform errors to `{ DiskFullError | StoreError }`
  - `withFsError(op, operation, path?)` — wraps any `Effect` with the error mapper
  - `withReadError(op, operation, path?)` — read-only variant (maps to `StoreError` only)
  - `ensureDirExists(fs, dir, description?)` — check + create directory pattern
  - `safeExists(fs, path)` — `fs.exists(path).pipe(Effect.catchAll(() => Effect.succeed(false)))`
- Replace all duplicated error-mapping in `vector-store.ts` and `config-store.ts` with imports from `fs-error.ts`
- Extract `makeJsonHandler(fs)` function in `Display.ts` — both `ClackDisplay` and `JsonDisplay` use it for their `json()` method
- Extract `wrapInteractive` helper for spinner/progress lifecycle (shared start/stop recording pattern between ClackDisplay and JsonDisplay)

**Risk:** Medium — touches error handling in services. Must preserve exact error messages and types.

**Depth consideration:** `FsErrorMapper` should be a pure module (no Effect layers, just functions that return Effect combinators). The interface is small: 5 functions. The behavior is all the platform-error-to-domain-error mapping logic. This is a deep module.

---

## Step 4: VectorStore Search Deepening

**Files:** `src/services/vector-store.ts` (399 LOC, search function at lines 256-320 is cyclomatic 13, 49.5 CRAP)

**Reason:** The `search` function does 7 things in 61 lines: index existence check, read chunks.jsonl, read vectors.bin, path filtering with `ignore` package, dot-product scoring, result assembly, validation error building, sorting, topK slicing. The `requireIndex()` check is duplicated with `getStatus()` (fallow detected a 14-line clone). The search function is the highest-complexity function in the codebase and the hardest to test — you can't test filtering without also testing scoring, can't test scoring without also testing file I/O.

**Changes:**

- Extract `ensureIndexExists(fs)` internal function → eliminates fallow clone with `getStatus`. Used by both `search` and `getStatus`.
- Extract `PathFilter` to `src/lib/path-filter.ts`:
  - Interface: `{ ignores(path: string): boolean }`
  - Two adapters: `IgnoreFilter` (uses `ignore` package for search-time ignorePaths/onlyPaths), `GitIgnoreFilter` (uses `ignore` package for scan-time gitignore rules)
  - This is a **real seam** — two adapters already exist implicitly
- Extract `computeDotProduct` and `serializeVectors` to `src/lib/vector-math.ts` (pure math, reusable for future SIMD/multi-core)
- Split `search` into internal functions:
  - `loadIndex(fs)` → reads + parses chunks.jsonl and vectors.bin
  - `scoreChunks(chunkLines, vectors, query)` → pure dot-product loop, returns `SearchResult[]`
  - `applyFilters(results, filter)` → applies PathFilter
  - `rankAndSlice(results, topK)` → sorts by score descending, takes topK
- Each internal function is testable independently

**Risk:** Medium — core search logic. Tests must stay green.

**Depth consideration:** After this refactoring, `search` becomes a composition of 4 deep internal functions. Each function has a small interface (few parameters, clear return type) and concentrates behavior. The `PathFilter` seam is real (two adapters) and should be a proper module with a small interface.

---

## Step 5: Query Command Formatting Extraction

**Files:** `src/commands/query.ts` (lines 23-54), `src/lib/format.ts` (lines 16-48)

**Reason:** `formatResult`, `formatLocation`, `buildContentFields`, `toJsonOutput` are module-private functions in the command file that format `SearchResult` for human and JSON output. The same context-before/after conditional pattern (`result.contextBefore ? \`\n${result.contextBefore}\` : ""`) is duplicated verbatim in `format.ts:28`inside`applyCharBudget`. The command module mixes CLI arg parsing, validation, search orchestration, **and** formatting behind a wide interface. This violates locality — formatting changes require touching the command file.

**Changes:**

- Create `src/lib/search-output.ts` with:
  - `formatResult(result: SearchResult): string` — full human-readable output with context
  - `formatLocation(result: SearchResult): string` — lightweight location reference (no text)
  - `formatResultMetadata(result: SearchResult): string` — shared `${file}:${startLine}-${endLine}` used by both above and by `applyCharBudget`
  - `buildContentFields(r, ctxLines, noContent): Record<string, unknown>` — optional content fields for JSON
  - `toJsonOutput(results, ctxLines, noContent)` — array of JSON-ready objects
- Extract `clampTopK` from `query.ts` to `src/lib/validation.ts` (already has `ValidationEntry`, `JsonDecodeError` — natural home for input validation)
- Update `format.ts:applyCharBudget` to use `formatResultMetadata` instead of duplicating the metadata string construction
- `query.ts` command becomes purely composition: parse args → validate → call ports → format via `search-output.ts` → emit

**Risk:** Low — formatting logic, well-tested.

**Depth consideration:** `search-output.ts` is a deep module: small interface (5 functions), all the formatting behavior concentrated inside. The command file becomes shallow by design — it's a composition root, not a formatting engine.

---

## Step 6a: Dtype Tracking Infrastructure

**Files:** `src/domain/`, `src/services/`, `src/application/`, `.pix/` directory structure

**Reason:** Currently the embedder always produces `Float32Array` vectors, but the config schema already supports `dtype: "fp32" | "fp16" | "q8" | "q4"`. Nothing tracks what dtype was used during indexing. Nothing prevents querying a q8 index with a fp32 embedding (garbage results). Before we can make `Embedding` dtype-aware, we need infrastructure to track and validate dtype across the system.

**Design decisions (already made):**

- **Storage:** Create `.pix/index-meta.json` (separate file, not in chunks.jsonl). Contains: `{ schemaVersion: "1", dtype: "fp32", dims: 384, model: "..." }`
- **vectors.bin** stays pure binary — no header, no magic bytes. Just the raw bytes.
- **Config:** `config.embedder.dtype` tracks the **selected** dtype for the embedder to work in.
- **Validation:** `config.embedder.dtype` must match `index-meta.json.dtype`. If mismatch → `DtypeMismatchError`.
- **Green field:** No migration needed. New project, new index format.

**Changes:**

- Create `src/domain/dtype.ts`:
  - `EmbeddingDtype` type: `"fp32" | "fp16" | "q8" | "q4"`
  - `IndexMeta` interface: `{ schemaVersion, dtype, dims, model }`
  - `DtypeMismatchError` tagged error class
- Create `src/lib/vector-decoder.ts`:
  - `VectorDecoder` abstract interface: `{ decode(buffer: Buffer, dims: number): number[]; encode(vectors: number[][]): Buffer }`
  - 4 adapters: `Fp32Decoder`, `Fp16Decoder`, `Q8Decoder`, `Q4Decoder`
  - `Q4Decoder` requires bit-unpacking (4 bits per value, 2 values per byte) — no native typed array exists
  - Factory: `getVectorDecoder(dtype: EmbeddingDtype): VectorDecoder`
- Update `VectorStore`:
  - `storeCommit()` writes `index-meta.json` alongside `chunks.jsonl` and `vectors.bin`
  - `storeAbort()` and `reset()` clean up `index-meta.json`
  - `search()` reads `index-meta.json` first, validates dtype matches config, then reads `vectors.bin` with correct decoder
- Update `Embedder`:
  - `embed()` and `batch()` produce vectors in the dtype specified by config
  - Return `Embedding` with dtype field: `{ vector: number[], dims: number, dtype: EmbeddingDtype }`
- Update `Embedding` type in `src/domain/chunk.ts`:
  - Change `vector: Float32Array` → `vector: number[]` (dtype-agnostic)
  - Add `dtype: EmbeddingDtype` field
  - Remove redundant `dims` field (always `vector.length`), or keep for performance (document the redundancy)

**Risk:** High — cascades through embedder, vector-store, search, tests. This is the foundation for all future embedding work.

**Depth consideration:** `VectorDecoder` is a real seam with 4 adapters. The interface is small (`decode`, `encode`), the behavior is all the binary encoding/decoding logic. This is a deep module. The dtype tracking in `index-meta.json` is a separate concern from the decoder — one is storage, one is transformation.

---

## Step 6: Domain Layer Cleanup

**Files:** `src/domain/models.ts`, `src/domain/ports.ts:220-245`, `src/domain/chunk.ts`

**Reason:** `models.ts` contains HuggingFace model IDs and quantization formats — adapter-specific data that only `embedder.ts` consumes. **Deletion test:** if deleted, the registry moves to `embedder.ts` and complexity vanishes from the domain. `DisplayUpdatePayload` (26-line discriminated union with `never` fields) encodes `@clack` progress bar semantics in the domain — a presentation concern. After step 6a, `Embedding` needs to be dtype-aware.

**Changes:**

- Move `models.ts` → `src/services/models.ts` (adapter-specific data, not domain knowledge)
- Move `DisplayUpdatePayload` from `ports.ts` → `src/display/` (presentation concern, domain port should not know about progress bar position semantics)
- Update `Embedding` type (already dtype-aware from step 6a):
  - `vector: number[]` (dtype-agnostic)
  - `dims: number` (keep for performance, document redundancy with `vector.length`)
  - `dtype: EmbeddingDtype` (from step 6a)
- Update CONTEXT.md:
  - Remove `Logger` from port examples (line 145 — no such port exists)
  - Update `Embedding` description to reflect dtype-awareness
  - Add `index-meta.json` to Store description
- Update `index.ts` barrel export: remove `models.ts` (now in services)

**Risk:** Medium — moves files, changes imports. No behavior change.

**Depth consideration:** The domain layer should only contain domain concepts. Model registries and UI payloads are not domain concepts. After this step, the domain layer is purely: entities (Chunk, Config), value objects (Embedding), errors, and ports.

---

## Step 7: Index Command Config Merging

**Files:** `src/commands/index-cmd.ts` (lines 35-58), `src/application/index-project.ts` (lines 48-58)

**Reason:** `buildIndexOptions` (command) and `deriveEffectiveConfig` (use case) both clamp values with `Math.max(1, ...)`. Default values `16` (batchSize) and `8` (chunkConcurrency) are hardcoded in the use case but also in `DEFAULT_CONFIG`. `--force` and `--verbose` are placeholders that only emit warnings — they add CLI surface without functionality. The command uses `catchAll(reportError)` while all other commands use `catchTags` — inconsistent error handling. Config merging is the #1 hotspot (51.4 score, 32 commits, 1005 churn).

**Changes:**

- Extract `mergeConfig(cli: IndexOptions, config: Config): EffectiveConfig` as pure function in `src/lib/config-merge.ts`:
  - Single responsibility: merge CLI options with config file, apply defaults
  - No duplication of default values — reads from `DEFAULT_CONFIG`
  - Clamping happens once here, not in both command and use case
- Move clamping to shared `clampPositive` in `src/lib/validation.ts`
- Remove `--force` and `--verbose` flags from `index-cmd.ts` entirely (verbosity will be tackled differently, force is future work for incremental indexing)
- Standardize all commands to `catchAll(reportError)` — currently `index-cmd.ts` uses `catchAll`, others use `catchTags`. `catchAll` is safer (catches unknown errors too) and `reportError` handles unknown tags gracefully ("UNKNOWN" code)
- Update `index-project.ts` to use `mergeConfig` instead of `deriveEffectiveConfig`

**Risk:** Medium — config merging is the most-changed code in the project. Must preserve exact behavior.

**Depth consideration:** `mergeConfig` is a deep module: small interface (one function), all the merging/clamping/defaulting logic inside. The command file becomes a thin composition layer.

---

## Step 8: Error Formatting Completeness

**Files:** `src/lib/error-format.ts`

**Reason:** The `errorCodes` map is missing 3 domain errors (`DisplayLogError`, `UnsupportedFormat`, `ExtractionFailed`). The TODO at lines 43-44 admits incomplete error parsing — `stack`, `model`, `file`, `path` fields are silently lost. Manual type guards (`typeof error === "object" && "_tag" in error`) instead of Effect's pattern matching. This means structured JSON output is incomplete for agents consuming error responses.

**Changes:**

- Replace manual type guards (`messageFromError`, `codeFromError`, `causeFromError`) with exhaustive `match` on `_tag` using Effect's pattern matching
- Add missing error codes to `errorCodes` map: `DisplayLogError`, `UnsupportedFormat`, `ExtractionFailed`
- Extract `catchAllCommandErrors` as shared error handler — currently each command manually lists which tags to catch. This function catches all domain errors and routes to `reportError`
- Add `formatErrorWithContext(error)` that extracts `model`, `file`, `path` when present on the error object — these fields exist on domain errors but are silently lost in current formatting
- Remove TODO comment at lines 43-44

**Risk:** Low — formatting only, no behavior change.

**Depth consideration:** `error-format.ts` should be a deep module: small interface (`formatError`, `reportError`, `catchAllCommandErrors`), all the error introspection and formatting logic inside.

---

## Step 9: Final Consolidation Pass

**Scope:** Full codebase scan after all refactorings

**Reason:** Refactoring chains leave artifacts: orphaned imports, now-redundant types, test utilities that can be merged, barrel exports that need updating, dead code introduced by earlier steps. A final pass catches these.

**Checks:**

- Orphaned imports (imports that reference nothing)
- Now-redundant types/interfaces (e.g., if `IndexStats` and `getStatus` return type were unified)
- Test utilities that can be merged (e.g., `makeFailing*` factories share identical structural pattern)
- Barrel exports that need updating (`src/domain/index.ts`, `src/lib/` if created)
- Dead code introduced by refactoring chain
- Fallow audit for new duplication
- CONTEXT.md consistency with actual code (all types, ports, commands documented)
- Run `vp run lint:fallow` — must pass with no violations

**Risk:** Low — cleanup only.

---

## Step Log

| Step  | Status      | Changes                                                   | Notes                                                                                                                                                                                                           |
| ----- | ----------- | --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ~~1~~ | ~~Removed~~ | Inconsistent pattern — keep all use cases in application/ |                                                                                                                                                                                                                 |
| 2     | Done        | -18 LOC net, 9 files                                      | Extracted runCommand, expectLogEntry, TEST_CONFIG_JSON, makeChunk, makeEmbedding. Deleted setup() and emptyScannerLayer duplicates. 141 tests pass.                                                             |
| 3     | Done        | +1 new file, 3 modified                                   | Extracted FsErrorMapper (withFsError, withReadError, ensureDirExists, withConfigError). Deleted safeExists (dead). makeJsonHandler shared by ClackDisplay/JsonDisplay. 8 tests for fs-error.ts. 149 tests pass. |
| 4     | Pending     | VectorStore search deepening                              | ensureIndexExists, PathFilter, vector-math, split search                                                                                                                                                        |
| 5     | Pending     | Query formatting extraction                               | search-output.ts, shared formatResultMetadata                                                                                                                                                                   |
| 6a    | Pending     | Dtype tracking infrastructure                             | index-meta.json, VectorDecoder, Embedding dtype-aware                                                                                                                                                           |
| 6     | Pending     | Domain layer cleanup                                      | Move models.ts, DisplayUpdatePayload, CONTEXT.md updates                                                                                                                                                        |
| 7     | Pending     | Index command config merging                              | mergeConfig, remove --force/--verbose, catchAll everywhere                                                                                                                                                      |
| 8     | Pending     | Error formatting completeness                             | Exhaustive match, missing codes, formatErrorWithContext                                                                                                                                                         |
| 9     | Pending     | Final consolidation                                       | Orphaned imports, dead code, CONTEXT.md sync, fallow audit                                                                                                                                                      |
