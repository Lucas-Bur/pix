# 0014: Tree-sitter for AST-based identifier extraction

## Status

Accepted

## Context

Issue #130 (exact-name identity channel) and #131 (camelCase split channel) require extracting code identifier names (function, class, type, const, etc.) from source text at index time so the new scoring channels can match user queries against them.

The naive option is regex: `/\b(?:function|class|interface|type|enum|const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)/g`. This captures the common cases but misses:

- Default exports: `export default function NAME`
- Decorated declarations: `@decorator class NAME`
- Computed names: `const NAME = ...`
- Generic type parameters: `function NAME<T>`
- Acronym boundaries: `XMLHttpRequest` vs `XML + Http + Request`

These edge cases are common enough in real code that a regex-based extractor would produce visibly wrong rankings for some queries. A full AST-based extractor is needed.

Issue #83 ("AST-aware chunking with tree-sitter") was opened for a related but larger goal: chunk at AST boundaries (function/class level) instead of line-based. That work was deferred to keep MVP scope small. We are now adopting tree-sitter for a _narrower_ purpose — identifier extraction only — and deferring AST-aware chunking to a future issue.

## Decision

Adopt [tree-sitter](https://tree-sitter.github.io/tree-sitter/) as the parsing engine for identifier extraction. Specifically:

- `tree-sitter` (npm package) — the core parser runtime
- `tree-sitter-typescript` — the TypeScript/JavaScript/TSX grammar (covers `.ts`, `.tsx`, `.js`, `.jsx`)

The dependency is installed in `dependencies` (not `devDependencies`) because `pix index` invokes the parser at runtime. The native binary is platform-specific (linux-x64, linux-arm64, darwin-x64, darwin-arm64, win32-x64, win32-ia32) and shipped via the package's `prebuilds/` directory — users do not need a C++ toolchain to install pix.

MVP scope: **TypeScript only**. Other languages (Python, Rust, Go) carry `parser: None` in the extension registry until their tree-sitter package is installed and a parser is wired in. The `Parser` field in `ExtensionEntry` is `Option<Parser>` specifically to support this staged rollout.

Identifier extraction is implemented in `src/lib/parsing/identifier-extractor.ts` as a pure function: `extractIdentifiers(parser, mapKind, text, chunkIndex) → readonly Identifier[]`. The per-language `mapKind` table (e.g. `typescriptMapKind` in `src/lib/parsing/typescript.ts`) maps tree-sitter node types onto the language-agnostic `IdentifierKind` vocabulary. The Effect port is `IdentifierExtractor` with one method, `extractIdentifiers(text, chunkIndex) → Effect<readonly Identifier[], never>`.

The `never` error type is honest: tree-sitter's design is to _never throw on parse failure_ — it always produces a (possibly partial) tree, with `ERROR` nodes at unparseable positions. The walker handles malformed input by simply yielding no identifiers at the broken positions. The native binary loading is a setup error, caught at layer construction.

## Rationale

**Why tree-sitter over alternatives**:

- **TypeScript Compiler API**: handles TypeScript perfectly, but TS-only. Python/Rust/Go would each need their own integration. Tree-sitter is the closest thing to a cross-language AST standard.
- **Babel parser (`@babel/parser`)**: well-tested for JavaScript and JS-flavored TS, but again language-specific.
- **Regex**: misses 20% of real-world cases (decorated classes, default exports, computed names, generic params). The 20% would visibly degrade rankings for the exact queries the new channel is designed to serve.
- **Hand-rolled recursive descent**: maximum control, no native dependency, but a multi-language implementation is months of work for diminishing returns.

Tree-sitter is the best trade-off: handles all the edge cases, works across many languages via separate per-grammar packages, and ships prebuilt native binaries per platform.

**Why the narrow scope (identifiers only, not chunking)**: AST-aware chunking (issue #83) is a larger architectural change — it would restructure how chunks are produced and stored, affecting the chunker, the storage shape, the query path, and the embedder pipeline. Extracting identifiers is a single new module with a clean boundary. The two concerns can be adopted independently; AST-aware chunking can be added later without revisiting the identifier extraction.

**Why per-chunk re-parsing, not parse-once-and-distribute**: A single file parse is more efficient, but it requires distributing identifiers to chunks by line number, which couples the extractor to chunker geometry. Per-chunk re-parsing is simpler, correctly handles overlap (the same identifier legitimately appears in multiple overlapping chunks), and the redundant work is bounded by `overlapLines × chunk count`.

**Why `dependencies` (not `devDependencies`)**: `@huggingface/transformers` is already a runtime dep for the same reason — model artifacts loaded lazily, but the package must be installed for `pix index` to function. Tree-sitter follows the same pattern: a runtime-needed package that ships prebuilt binaries per platform.

**Why a downgrade to `0.21.x`**: tree-sitter `0.25.x` no longer ships prebuilt binaries in the `prebuilds/` directory — its install script runs `node-gyp rebuild`, which requires a C++ toolchain the user may not have. `0.21.x` keeps the prebuilt-binary distribution model. The prebuild approach is the right one for a CLI distributed via npm.

**Why `Effect<…, never>`**: tree-sitter's design guarantees no parse-time throw. The walker handles malformed input gracefully (returns partial results). The only setup-time failure (binary missing, grammar not loaded) is caught at layer construction, not at parse time. `never` is honest about this.

## Consequences

- Tree-sitter is now a runtime dependency, adding ~5 MB to the published package (parsers + native binaries per platform, tree-shaken to only what's actually loaded).
- The extension registry is structured to accommodate additional languages: adding a new one means installing `tree-sitter-<lang>`, adding a `<lang>MapKind` table in `src/lib/parsing/<lang>.ts`, and adding entries to the `DEFAULT_EXTENSION_REGISTRY` for that language's file extensions.
- Per-chunk parsing is wasteful for overlapping chunks but acceptable for MVP. AST-aware chunking (#83) would let the extractor parse each file once and distribute identifiers to chunks — deferred to a future issue.
- The `Parser` field of `ExtensionEntry` is `Option<Parser>` rather than `Parser` so that unsupported extensions (text, config, binary) carry `None` and gracefully skip the extraction step. The `IdentifierExtractor` service for MVP always uses the TypeScript parser; per-language services can be added as the language set grows.
- Identifier extraction is performed per chunk at index time. For typical codebases (chunk lines 60, overlap 10) this is on the order of thousands of small parses per index run, which finishes in well under a second on a modern machine. No perceptible index-time regression.
- The `Identifier` type captures `name`, `kind`, and `chunkIndex`. The `kind` field is language-agnostic (function/type/value). MVP scorers do not differentiate by `kind`; it is captured for future use cases (e.g. "find class definitions only" or "find where this is imported", #85) without re-indexing.
