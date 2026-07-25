# 0018: SQLite index persistence and native vector search

## Status

Accepted

## Context

The generated index was split across seven JSON, JSONL, and binary files. A complete replacement
required sequential renames, so interruption during commit could expose files from different index
generations. Query also loaded every Float32 vector into JavaScript for exact cosine ranking.

## Decision

- Store all generated index state in `.pix/index.db`: metadata, chunk metadata and embeddings, file
  observations, BM25, identifier postings, historical embedding cache, and migration history.
- Keep editable config, aliases, model artifacts, and source files outside the database.
- Manage schema evolution with Effect SQL `SqliteMigrator` migrations.
- Define database rows with `Model.Class` and validate SQL requests/results with `SqlSchema`.
- Use SQLite `STRICT` tables, a unique chunk ID, integer millisecond timestamps, and JSON validity
  constraints for aggregate retrieval payloads.
- Transform SQLite BLOBs to aligned `Float32Array` values through one bidirectional Effect Schema.
- Drain streamed embedding batches inside a SQLite transaction. A failed stream rolls back and leaves
  the previous snapshot visible.
- Use an explicit `ordinal` as the generation-local identity shared by vector, BM25, identifier, and
  RRF channels. SQLite `rowid` is only an implementation detail used to join vector scan results.
- Run exact cosine search with sqlite-vector `vector_full_scan` by default. Preserve the JavaScript
  `rankDense` implementation as the correctness oracle.
- Support `exact`, `auto`, and `turboquant` modes. `auto` uses TurboQuant only at or above
  `vectorSearch.turboQuantThreshold`; TurboQuant uses four-bit quantization. Persist completed
  quantization state in index metadata so reopened stores reuse sqlite-vector's shared DB state.
- Keep path filtering after RRF and before top-K selection. Dense scans return the complete positive
  ranking so candidate truncation does not change fusion semantics.
- `pix reset` deletes active index rows while retaining `embedding_cache`; `pix cache clear` deletes
  that cache explicitly.
- Do not import old generated flat files. The next index refresh rebuilds SQLite and removes obsolete
  generated artifacts.

## Native packaging

`@sqliteai/sqlite-vector` declares platform binaries as optional dependencies. Under pnpm's isolated
linker they are nested below the generic package and cannot be resolved from application
`import.meta.url`. Resolve the generic package first, create a `require` rooted at that module, and
resolve the package returned by `getPlatformPackageName()` from there. Platform packages are not
declared directly by pix.

`@effect/sql-sqlite-node` remains an external runtime dependency and delegates to Node's built-in
`node:sqlite` module. No native third-party SQLite package is installed.

Effect, Effect Platform, Clack, and Ignore are bundled build inputs and remain dev dependencies.
Fallow's source-level dependency analysis cannot observe that bundle boundary, so its corresponding
`dev dependencies used in production` report is expected. PRs use the base-aware Fallow audit to gate
new findings rather than changing runtime packaging to satisfy the full-repository health report.

sqlite-vector is distributed under a modified Elastic License 2.0 with an open-source grant. pix is
MIT-licensed and adopts the extension under that grant. This is an accepted project decision rather
than a claim about downstream commercial licensing.

## Consequences

- Snapshot replacement and migration history become transactional.
- Query no longer loads all active vectors into JavaScript.
- Native package loading must be tested from packed, clean installations on supported targets.
- SQLite and sqlite-vector add native runtime dependencies.
- Approximate TurboQuant results can differ from exact RRF results and require recall regression tests.
- ADRs 0003, 0008, 0009, 0013, and 0017 remain valid for their architectural and retrieval decisions;
  this ADR supersedes their flat-file storage details.
