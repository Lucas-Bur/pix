# PR 111 — Post-Review Implementation TODO

Generated from CodeRabbit reviews on PR #111 (`feat: structured file logging + Display port to domain layer`).

## Legend

- ✅ **Done** — already addressed in subsequent commits
- ⏳ **Pending** — still needs work
- ⏭️ **Skip** — decided not to implement (reason noted)
- ❌ **Skipped — not applicable** — code has changed since review

---

## Phase 1: Quick Correctness Fixes

### 1.1 `src/lib/validation.ts` — Handle non-finite inputs in `clampTopK`

- **Status:** ⏳ Pending
- **Change:** Add `if (!Number.isFinite(value)) return { value: min, clamped: true }`
- **Risk:** None. Pure safety improvement.

### 1.2 `src/lib/fs-error.ts:45` — Use `withReadError` for `fs.exists`

- **Status:** ⏳ Pending
- **Change:** `withFsError` → `withReadError` in `ensureDirExists`
- **Risk:** None. `exists` is read-only; mapping it via `withFsError` could incorrectly surface `DiskFullError`.

### 1.3 `src/lib/config-merge.ts` — Clamp `batchSize` to positive

- **Status:** ⏳ Pending
- **Change:** Wrap `batchSize` in `clampPositive()` like `concurrency` already is.
- **Risk:** None.

### 1.4 `src/commands/index-cmd.ts` — Add positive validation for CLI options

- **Status:** ⏳ Pending
- **Change:** In `buildIndexOptions`, filter out non-positive batchSize/chunkConcurrency (let mergeConfig clamp).
- **Risk:** None.

---

## Phase 2: Test Robustness

### 2.1 `src/display/Display.test.ts` — Isolate FS state per test

- **Status:** ⏳ Pending
- **Change:** Create per-test `JsonDisplay` layer + MemoryFileSystem, use `Layer.provide` not `Layer.mergeAll`
- **Risk:** Medium — tests might need adjustment. Eliminates test order dependency.

### 2.2 `src/commands/query.command.test.ts` — Harden JSON assertions

- **Status:** ⏳ Pending
- **Change:** Replace `if (Array.isArray(data))` guards with unconditional `expect(Array.isArray(data)).toBe(true)`
- **Risk:** None.

### 2.3 `tests/test-utils/command.ts` — Realistic embeddings in `makeFailingEmbedder`

- **Status:** ⏳ Pending
- **Change:** Return `items.map(() => ({ vector: new Float32Array(384), dims: 384, dtype: "fp32" }))` instead of `[]`
- **Risk:** None.

---

## Phase 3: Docs / JSDoc

### 3.1 `docs/adr/0007-display-service-pattern.md` — Add `## Rationale` section

- **Status:** ⏳ Pending
- **Change:** Insert Rationale section between Decision and Consequences.
- **Risk:** None. ADR format compliance.

### 3.2 `src/domain/chunk.ts` — Add JSDoc to `Embedding` interface

- **Status:** ⏳ Pending
- **Change:** Add JSDoc describing Embedding, vector, dims.
- **Risk:** None.

### 3.3 `src/domain/dtype.ts` — Add JSDoc to all exported types/errors

- **Status:** ⏳ Pending
- **Change:** JSDoc for `EmbeddingDtype`, `IndexMeta`, `DtypeMismatchError`, `VectorDecodeError`, `VectorEncodeError`, `UnknownEmbeddingDtypeError`
- **Risk:** None.

### 3.4 `docs/refactoring-backlog.md` — Fix malformed code span (MD038)

- **Status:** ⏳ Pending
- **Change:** Fix backtick around `applyCharBudget`
- **Risk:** None.

---

## Phase 4: Precompute Filter Matchers

### 4.1 `src/lib/path-filter.ts` — Precompute matcher once per filter

- **Status:** ⏳ Pending
- **Change:** Create `const matcher = ignore().add([...patterns])` in factory, close over it.
- **Risk:** None. Micro-optimization, but correct.

---

## Phase 5: Display Logging Completeness

### 5.1 `src/display/Display.ts:213-231` — Log `updateInteractive` in ClackDisplay

- **Status:** ⏳ Pending
- **Change:** Add `appendLogEntry(fs, { type: "update", message: ... })` at top of `updateInteractive`
- **Risk:** Low. Completes audit trail invariant.

### 5.2 `src/display/Display.ts:251-274` — Log stop events on failure in JsonDisplay

- **Status:** ⏳ Pending
- **Change:** Use `Effect.exit` wrapper to ensure `spinner-stop`/`progress-stop` always logged.
- **Risk:** Low. Standard Effect pattern.

---

## Phase 6: Vector Safety

### 6.1 `src/lib/vector-codec.ts:29-35` — Validate buffer length in `decode`

- **Status:** ⏳ Pending
- **Change:** Check `buffer.byteLength === dims * count * BYTES_PER_ELEMENT` before constructing Float32Array
- **Risk:** None. Prevents silent data corruption.

### 6.2 `src/lib/vector-codec.ts` — Tests for `getVectorCodec`

- **Status:** ⏳ Pending
- **Change:** Unit tests covering fp32, unsupported dtypes, unknown dtype branches.
- **Risk:** None. Adds missing coverage.

### 6.3 `src/lib/vector-math.ts` — Validate embedding shape in `serializeVectors`

- **Status:** ⏳ Pending
- **Change:** Loop over embeddings, verify consistent dims before serializing.
- **Risk:** None.

---

## Phase 7: Refactor renderResults + Tests

### 7.1 `src/commands/query.ts` — Split `renderResults` + add tests

- **Status:** ⏳ Pending
- **Change:** Extract `renderResultsJson` and `renderResultsText` helpers.
- **Risk:** Low. Pure extraction, no behavioral change.

---

## Phase 8: vector-store.ts Refactor

### 8.1 `src/services/vector-store.ts` — Add dims compatibility check in `search`

- **Status:** ⏳ Pending
- **Change:** Compare query.dims against indexMeta.dims before scoring.
- **Risk:** Low. Early failure on config mismatch.

### 8.2 `src/services/vector-store.ts` — Fix `batchBytes` calculation

- **Status:** ⏳ Pending
- **Change:** Use `buffer.byteLength` instead of `embeddings.length * dims * 4`
- **Risk:** None. More correct for non-fp32.

### 8.3 `src/services/vector-store.ts` — Split `search`/`getStatus` complexity

- **Status:** ⏳ Pending
- **Change:** Extract helpers: `loadAndValidateIndexMeta`, `readChunksFile`, `readVectorsBuffer`, `decodeVectors` for the `loadIndex` path; minor extraction already done.
- **Risk:** Medium. Large refactor, but functions are already decomposed (`scoreChunks`, `applyFilters`, `rankAndSlice`).

---

## Phase 9: Display.ts Complexity

### 9.1 `src/display/Display.ts` — Refactor spinner/progress complexity

- **Status:** ⏳ Pending
- **Change:** Extract shared lifecycle helpers for start/stop logging + active state.
- **Risk:** Medium. Interactive state is delicate; must preserve terminal UX.

---

## Phase 10: index-project.ts Complexity

### 10.1 `src/application/index-project.ts` — Split `index` into phase helpers

- **Status:** ⏳ Pending
- **Change:** Extract `prepareConfigAndScan`, consolidate `classifyAndCollectChunks`.
- **Risk:** Medium. Large function but already has some extraction.

---

## Phase 11: fallow Cleanup (Clones, Duplication, Dead Code)

### 11.1 Run `vp run lint:fallow` and address findings

- **Status:** ⏳ Pending
- **Scope:** Duplication, dead code, code clones across the repo.
- **Risk:** Variable — depends on findings.

---

## Items Skipped / Already Addressed

| #   | File                                                   | Reason                                                                     |
| --- | ------------------------------------------------------ | -------------------------------------------------------------------------- |
| ❌  | `src/lib/error-format.ts:5-17`                         | `DisplayLogError: "DISPLAY_LOG_ERROR"` already present at line 17          |
| ❌  | `src/commands/index-cmd.command.test.ts`               | vacuous `messageIncludes: ""` already addressed in commits 07bb322→eca4f8a |
| ❌  | `CONTEXT.md:145`                                       | Display already added to port examples list                                |
| ❌  | `src/commands/index-cmd.ts:106-126` handler complexity | Handler already simplified to ~18 lines, currently well below threshold    |
| ⏭️  | `src/lib/config-merge.ts:14` complexity                | Function is a simple object literal; will refactor if `vp check` flags it  |

---

## ADR Cross-Check

| ADR                                          | Impact Assessment                                                                  | Conflict? |
| -------------------------------------------- | ---------------------------------------------------------------------------------- | --------- |
| ADR 0003 (Hexagonal Architecture)            | All changes maintain layer boundaries                                              | ✅ None   |
| ADR 0007 (Display Service Pattern)           | updateInteractive logging + stop-on-failure align with "every Display call logged" | ✅ None   |
| ADR 0008 (Embedding Internal Representation) | Buffer validation + shape checks are defensive, no contract change                 | ✅ None   |
