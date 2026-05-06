# PRD: Hexagonal Architecture & DDD for pix

## Goal

Refactor pix to follow hexagonal architecture (ports & adapters) and DDD principles for better maintainability, testability, and scalability.

## Context

pix is a CLI tool for semantic code indexing using Effect. Currently:

- Layer injection is centralized in `index.ts` (Layer provision removed from services)
- Services declare dependencies via Effect tags (`FileSystem.FileSystem`)
- CLI commands live in `commands/`, types in `types.ts`, services in `services/`

The foundation for hexagonal architecture exists but needs explicit port interfaces and clearer layer separation.

## Principles

1. **Dependency Inversion**: High-level modules don't depend on low-level modules; both depend on abstractions (ports)
2. **Ports & Adapters**: Define service interfaces (ports), provide concrete implementations (adapters)
3. **DDD Layers**: Domain (pure business logic) → Application (use cases) → Infrastructure (adapters)
4. **Effect Tags**: Use `Context.Tag` for all ports; provide layers at composition root

## Scope

### In Scope

- Extract explicit port interfaces for all external dependencies
- Create domain layer with value objects and entities
- Create application layer with use cases
- Create infrastructure layer with adapters
- Composition root wiring in `index.ts`
- Tests with mock adapters

### Out of Scope

- Changing CLI commands (init, index, query, etc.) — only how they're wired
- Changing the embedding model or ONNX runtime
- GUI or web interface

## Vertical Slices (for Issues)

### Slice 1: Config Port & Adapter

- Define `ConfigStore` port (tagged interface with `readConfig`, `writeConfig`, `configExists`)
- Create `FileSystemConfigStore` adapter implementing the port
- Update `store.ts` to implement the port
- Update tests to use port interface; add mock adapter for testing

### Slice 2: Domain Layer — Value Objects & Entities

- Create `src/domain/` with:
  - `Config` entity (from current `types.ts`)
  - `Chunk` entity (id, content, filePath, startLine, endLine)
  - `Embedding` value object (vector: Float32Array, dims: number)
  - `FilePath` value object with validation
- Move relevant types from `types.ts` to domain layer

### Slice 3: Scanner Port & Adapter

- Define `Scanner` port (tagged interface with `scanFiles(extensions): Effect<FilePath[]>`)
- Create `FastGlobScanner` adapter using `fast-glob` + `ignore`
- Update `types.ts` to use domain `FilePath` value object
- Tests with mock scanner

### Slice 4: Embedder Port & Adapter

- Define `Embedder` port (tagged interface with `embed(text): Effect<Embedding>`, `batch(texts): Effect<Embedding[]>`)
- Create `OnnxEmbedder` adapter using `@huggingface/transformers`
- Configure via Config (model, dims, batch size)
- Tests with mock embedder (no ONNX runtime needed)

### Slice 5: VectorStore Port & Adapter

- Define `VectorStore` port (tagged interface with `store(embeddings)`, `search(query, topK): Effect<SearchResult[]>`)
- Create `FileSystemVectorStore` adapter (writes `chunks.jsonl` + `vectors.bin`)
- Tests with mock store

### Slice 6: Application Layer — Use Cases

- Create `src/application/` with use cases:
  - `InitProject` (wraps current `runInit`)
  - `IndexProject` (scan → chunk → embed → store)
  - `QueryProject` (embed query → search → return results)
  - `GetStatus` (show index statistics)
  - `ResetIndex` (delete index files)
- Each use case declares required ports via Effect tags
- Tests for each use case with mock ports

### Slice 7: Composition Root

- Update `index.ts` to:
  - Import all port layers
  - Compose full application layer: `const appLayer = Layer.mergeAll(configLayer, scannerLayer, embedderLayer, vectorStoreLayer)`
  - Provide to CLI: `cli(...).pipe(Effect.provide(appLayer), NodeRuntime.runMain)`
- Update `cli.ts` to use application layer use cases instead of direct service calls

### Slice 8: Update CLI Commands

- Refactor `commands/init.ts` to use `InitProject` use case
- Create `commands/index.ts` using `IndexProject` use case
- Create `commands/query.ts` using `QueryProject` use case
- Create `commands/status.ts` using `GetStatus` use case
- Create `commands/reset.ts` using `ResetIndex` use case
- All commands declare their port requirements; satisfied at composition root

## Success Criteria

- [ ] All external dependencies are behind port interfaces (tagged)
- [ ] Domain layer has no infrastructure dependencies
- [ ] Application layer use cases are testable with mock adapters
- [ ] Composition root (`index.ts`) wires all layers
- [ ] All tests pass with both real and mock adapters
- [ ] `CONTEXT.md` updated with new architecture glossary
- [ ] `docs/adr/` updated with architecture decision record
