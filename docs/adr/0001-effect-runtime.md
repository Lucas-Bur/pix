# Effect as Runtime and CLI Framework

## Status

Accepted

## Context

pix needs typed failures, dependency injection, structured concurrency, resource safety, and a CLI
that can share application workflows with MCP and tests. A simpler command parser would not provide
those runtime guarantees.

## Decision

Use Effect v4 for the runtime, platform adapters, CLI, schemas, and tests. Vite+ remains the test
runner; Effect-aware tests use `@effect/vitest`. TypeScript 7 supplies the native TypeScript-Go
compiler and language server, while `@effect/tsgo` adds Effect-specific diagnostics and editor
features.

## Rationale

One runtime model covers typed errors, layers, scoped resources, concurrency, deterministic test
clocks, CLI commands, and MCP integration. The TypeScript-Go tooling checks the same Effect-specific
invariants locally and in CI without restoring the legacy language-service package.

## Consequences

- Effect packages that share runtime values must stay on one coherent version line.
- Effect-returning tests use `@effect/vitest` helpers such as `it.effect` and `TestClock`.
- Effect diagnostics run through `vp run lint:effect*` and the installed `@effect/tsgo` package.
- The `tsconfig.json` plugin identifier remains `@effect/language-service` because it names the
  embedded plugin, not an npm dependency.
