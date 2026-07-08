# Hexagonal Architecture & DDD for pix

## Status

Accepted

## Context

pix started with services in a flat `services/` directory calling each other directly. As the codebase grew, this created tight coupling and made unit testing each service in isolation impractical. We needed a structure that:

- Allows testing use cases with mock infrastructure (no ONNX, no filesystem)
- Keeps business logic independent of I/O concerns
- Leverages Effect's `Context.Tag` for dependency injection natively
- Follows DDD layer separation: Domain → Application → Infrastructure

## Decision

We adopt hexagonal architecture (ports & adapters) with three DDD layers:

### Domain Layer (`src/domain/`)

Pure TypeScript — no Effect, no I/O, no infrastructure dependencies. Contains:

- **Entities**: `Config`, `Chunk` — structured data with identity
- **Value objects**: `Embedding` — identified by value, immutable
- **Ports**: `Context.Tag` interfaces in `src/domain/ports.ts` defining what the application needs: `ConfigStore`, `Scanner`, `Chunker`, `ContentExtractor`, `IdentifierExtractor`, `Embedder`, `IndexStore`, `Display`, `Clipboard`, `QueryAliasStore`, `ModelRegistry`, `DeviceDetection`
- **Error types**: `AllConfigErrors`, `ModelLoadError`, `InferenceError`, `ChunkerError`, `StoreError`, `ClipboardError`, `InteractiveError`

### Application Layer (`src/application/`)

Use cases implemented as `Effect.Service` classes. Each declares its dependencies via `yield* PortTag` and contains pure orchestration logic — no filesystem access, no ONNX calls, no shell commands:

- `InitProject` — writes default config
- `IndexProject` — scan → chunk → embed → store pipeline
- `QueryProject` — embed query → search store
- `GetStatus` — read index statistics
- `ResetIndex` — delete index files

Use cases are testable with mock adapters; tests exist for all five.

### Infrastructure Layer (`src/services/`)

Concrete adapters implementing the domain ports:

- `ConfigStoreLive` — reads/writes `.pix/config.json` via Node.js `fs`
- `ScannerLive` — `fast-glob` + `.gitignore`-aware scanning
- `ChunkerLive` — splits source files into Chunks
- `OnnxEmbedderLive` — ONNX runtime with `Xenova/all-MiniLM-L6-v2`
- `IndexStoreLive` — flat `chunks.jsonl` + `vectors.bin` + `bm25.json`

Each adapter is an `Effect.Layer` providing its corresponding port tag.

### Composition Root (`src/index.ts`)

Wires everything in explicit layers:

1. Infrastructure services merge, provided with `NodeContext.layer`
2. Chunker (depends on ConfigStore) receives infra layer
3. Application use cases merge and receive infra layer
4. CLI receives the composed AppLayer

## Rationale

- **Effect-native**: `Context.Tag` + `Layer` are first-class DI primitives — no external DI library needed
- **Testability**: Application use cases can be tested by providing mock layers (e.g., in-memory IndexStore) without ONNX or filesystem
- **Separation of concerns**: Domain has zero Effect imports; Application has infrastructure imports only through port tags
- **Reversible**: Each port can be swapped independently — e.g., replacing ONNX with OpenAI embeddings means only swapping one adapter
- **CLI independence**: Commands depend only on application layer use cases, not on services directly

## Consequences

- **Positive**: All 25 tests pass; use cases are independently testable; adding new infrastructure providers is straightforward
- **Positive**: Layer graph is explicit and centralized in `index.ts` — wiring is auditable in one place
- **Negative**: More files and indirection than a flat service directory; ports must be kept in sync with adapters
