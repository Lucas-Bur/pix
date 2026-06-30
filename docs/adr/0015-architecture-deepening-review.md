# 0015: Architecture Deepening Review

## Status

Accepted

## Context

A targeted review of the `pix` codebase to find places where **shallow modules** (interfaces nearly as complex as their implementations) or **leaky seams** (adapter internals exposed through port surfaces) were creating friction. The aim was testability and AI-navigability — fewer, deeper modules with clear responsibility.

The review followed the principles in `docs/rules/LANGUAGE.md` and `.agents/skills/improve-codebase-architecture/SKILL.md`. Work was done on branch `arch/deepening-review` and never pushed.

## What was found, and what was done

The review surfaced 12 candidates. The three that were truly fundamental — fixing them would simplify many call sites, eliminate real duplication, and improve fallow's structural metrics — were executed. The other nine were either too speculative, contradicted an existing ADR without strong reason, or addressed friction that wasn't actually present.

### Executed

1. **Removed barrel re-exports** in `src/services/{chunker,config-store,embedder,scanner}.ts`. The four files re-exported their port classes (`export { Chunker }`, etc.) for legacy reasons. No current caller used these re-exports — they all import from `src/domain/ports.js` directly. Fallback tests had to be updated to import from the domain module. _Fallow:_ 4 dead exports removed.

2. **Eliminated three duplication clusters** flagged by fallow (112 lines total):
   - **`computeRecommendation`**: 31-line pure function existed in both `src/application/bench-project.ts:62-95` and `src/lib/bench/format.ts:30-63` (latter was unexported). Exported from `lib/bench/format.ts` and deleted from `bench-project.ts`.

   - **`readConfigWithConflicts`**: 17-line method in `src/services/config-store.ts:159-177` that was functionally identical to `healConfig()` — same input, same output, both threw on unhealed conflicts. Removed the redundant method, renamed the test that exercised it to test `healConfig` instead.

   - **Embedder config resolution**: 8-line block duplicated between `src/services/embedder.ts:144-151` (resolveEmbedderConfig) and `src/application/bench-project.ts:157-175` (getEmbedderConfig). Extracted `src/lib/embedder/resolve.ts` with the shared "read config → resolve model → fail on unknown" logic. `embedder.ts` adds device detection on top; `bench-project.ts` uses the bare resolver.

3. **Collapsed `IndexStore` staging lifecycle** behind a single `persistIndex` operation. The port had 5 lifecycle methods (`storeBegin`, `storeBatch`, `storeIdentifierIndex`, `storeCommit`, `storeAbort`) that forced the use case to orchestrate them in the right order with explicit `Effect.matchEffect` cleanup. The adapter was the only thing that knew the order mattered, and the staging was an implementation detail of the temp-file atomic-rename strategy — not business logic.
   - Port now exposes one method: `persistIndex(input: { chunks: Stream<ChunkBatch, E>, identifierIndex: IdentifierIndexMaps }) → Effect<IndexStats, StoreError | DiskFullError | E>`. The stream's error type is parameterised so use cases can stream embedder results that can fail inference mid-batch.
   - Adapter owns begin → consume stream → write identifier index → commit/abort internally. Failure cleanup is guaranteed by the adapter, not by the use case remembering to call `storeAbort`.
   - Use case `src/application/index-project.ts:200-237` is now 8 lines shorter and reads as: "embed chunks, then hand the stream + identifier index to the store".
   - Five lifecycle tests collapsed into one integration test (`persistIndex aborts and cleans up when stream errors mid-write`).

### Skipped (and why)

The full candidate list was presented to the reviewer (you) before any work began. Of the twelve candidates, the following nine were **not** executed, with reasons:

- **Trivial use cases (ADR-0010)**: `InitProject`, `ResetIndex`, `GetStatus` are 5/1/1-line delegations to single port methods. ADR-0010 explicitly preserves them for "contributor knows where to look" value. Deleting them would scatter Init/Reset/Status logic into the command layer. The principle holds for non-trivial commands; for these, the use case is a pass-through — but the _position_ in `src/application/` is the value. _Verdict:_ keep, document.

- **`classifyFiles` extraction (Kandidat 5)**: The function in `src/application/index-project.ts:42-71` and its near-duplicate in `bench-project.ts:103-142` are the same shape. But the duplication is 30 lines, not 8 — the cost/benefit is similar to the embedder resolve extraction that _was_ done. Could be done as a follow-up; not blocking.

- **`extractF32Data` cast safety (Kandidat 6)**: The cast `tensor.data as Float32Array` in `src/services/embedder.ts:35` is documented in ADR-0008. Adding a runtime check would catch a hypothetical bug, but no provider exists today that breaks the invariant. _Verdict:_ add a comment if concerned, not worth a refactor.

- **Query routing as separate module (Kandidat 4)**: `WEIGHT_*` constants + `routeQuery` live in `src/application/query-project.ts:76-107`. ADR-0013 explicitly placed them there for "visibility and easy hand-tuning". Extracting them is fine, but ADR-0013 was a conscious choice and no new tuning need has emerged. _Verdict:_ revisit if/when query routing grows new channels.

- **Spinner state consolidation (Kandidat 9)**: The three `Ref`s in `ClackDisplay` (`activeRef`, `handleRef`, `lastSpinnerMsg`) could be unified into a `SpinnerState` class. Real but not fundamental — the spinner code is in one file and works. _Verdict:_ not enough friction to justify.

- **Error codes map (Kandidat 10)**: `errorCodes` in `lib/errors/error-format.ts:9-28` is a separate table that could be co-located with each error class. The cost is low (one map is easy to read) and the win is small (no future drift). _Verdict:_ skip unless errors are added frequently.

- **`Result.match` indirection in bench command**: Trivial cleanup, single call site. _Verdict:_ not worth a commit.

- **`tokenize` vs `splitIdentifier` documentation**: Two functions in `lib/retrieval/tokenize.ts` and `lib/parsing/split-identifier.ts` look similar but operate on different inputs. A doc comment would clarify; not a code change. _Verdict:_ not blocking.

## Test fixture cleanups

Two scripts in `scripts/` (`bench-startup.mjs`, `check-dtype-output.mjs`) were not imported by any code, not referenced by `package.json`, and not run in CI. Fallow flagged both. Deleted. The ADR-0008 reference to `scripts/check-dtype-output.mjs` (which contained the experimental dtype verification) was updated to refer to the historical fact, not the deleted file.

## Fallow configuration

The fallow config at `.fallowrc.json` was previously empty for `entry` and `ignorePatterns`, which caused fallow to flag exports and files that are legitimately used by tests. Two changes:

- `entry: ["src/index.ts", "tests/test-utils/silentDisplay.ts"]` — lets fallow trace from both production and test entry points. `silentDisplay.ts` is the file that imports `SilentDisplayLive` and `DisplayEntry`; once it's an entry, fallow credits those consumers.
- `/** @public */` JSDoc tags added to the `DisplayEntry` type and constructor in `src/display/entries.ts` — these are part of the test-assertion surface and fallow doesn't trace through the test files.

## Results

| Metric                                    | Before           | After                             |
| ----------------------------------------- | ---------------- | --------------------------------- |
| `vp check`                                | pass             | pass                              |
| `vp test`                                 | 344 / 344        | 344 / 344                         |
| `vp run build`                            | pass             | pass                              |
| `vp run lint:effect` errors               | 0                | 0                                 |
| `vp run lint:effect` warnings             | 2                | 1 (pre-existing in `bench.ts:58`) |
| Fallow dead files                         | 4 (5.2%)         | 0 (0.0%)                          |
| Fallow dead exports                       | 11 (5.6%)        | 0 (0.0%)                          |
| Fallow duplicated lines                   | 112 (1.9%)       | 0 (0.0%)                          |
| Fallow maintainability index              | 88.4             | 90.5                              |
| Total LOC                                 | 6,097            | 5,975                             |
| `IndexStore` port methods                 | 8                | 4                                 |
| Use case orchestration for `persistIndex` | 5 explicit calls | 1 call                            |

The `IndexStore` port went from 5 lifecycle methods + 3 read-side methods (8 total) to 1 write method + 3 read-side methods (4 total). The use case is simpler, the adapter is more cohesive (lifecycle is encapsulated), and the test surface is smaller (one `persistIndex` test instead of five stage-by-stage tests).

## Why these three, and not more

The reviewer's guidance was: "es ist für mich okay, wenn ein paar sachen leicht zu viel sind/überflüssig sind, wenn sie zu einem einfachen verständnis der codebasis und der flüsse beitragen. Handle nach besten Gewissen und geh die Probleme nach Evaluierung an. Es geht nicht darum maximal viel zu machen, sondern grundlegende Arbeit zu machen."

The three executed changes are **fundamental** in the LANGUAGE.md sense: each removed a real, measurable source of friction that touched multiple call sites and would have continued to grow as the codebase evolves. The nine skipped candidates were either too speculative (no current pain), contradicted conscious design decisions (ADR-0010, ADR-0013) without strong reason, or were marginal improvements that don't pay back the change cost.
