---
---

# Coding Standards for pix

## TypeScript Rules

- NO `as any`, `as never`, `as unknown` — fix underlying types
- Use `Option<T>` internally, `T | null` at boundaries (React state/props, JSON, external APIs)
- Every interface, type, and exported function MUST have JSDoc
- NEVER import `.js` files in TypeScript — use `.ts` or no extension

## Code Structure

- `src/cli.ts` = command composition (root + subcommands)
- `src/index.ts` = wiring (layers + runtime)
- One command per file: `src/commands/<name>.ts`
- Co-located tests: `<file>.test.ts` next to source

## Effect-TS Rules

- Use `Effect.gen` for imperative-style Effect code
- Use `Effect.tryPromise` for async operations that can fail
- Use `Data.TaggedError` for typed errors (e.g., `ConfigError`)
- Provide services via `Effect.provide(layer)`, not direct imports
- Compose layers with `Layer.merge(Layer1, Layer2)`
- Never use try-catch in Effect.gen — Effect failures are returned as exits
- Never use `Effect.sync` for file operations — use `Effect.try`/`Effect.tryPromise`
- Use `return yield*` when yielding errors or interrupts in Effect.gen

## Stream Safety

- Always bound consumption of streams
- Use `Stream.take(infiniteStream, N)` or `Effect.timeout("5 seconds")`

## TDD Process

- Vertical slices: test1 → impl1, test2 → impl2 (NOT horizontal)
- Test behavior, not implementation
- Test through public interfaces only
- One test at a time (RED → GREEN → refactor)
- Tests should survive internal refactoring

## Research Rule

- When you don't know the API → start a subagent to research
- Don't guess or use `as any` as workaround
- Read `.d.ts` files in `node_modules` for correct types
- Check `~/.effect/packages/effect/src/` for Effect-TS source code
