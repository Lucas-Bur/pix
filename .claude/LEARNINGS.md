# Learnings & Patterns for pix

## DO's

### Code Structure

- Keep `src/cli.ts` for command composition (root + subcommands)
- Keep `src/index.ts` for wiring (layers + runtime)
- One command per file: `src/commands/<name>.ts`
- Co-located tests: `<file>.test.ts` next to source

### Effect Patterns

- Use `Effect.gen` for imperative-style Effect code
- Use `Effect.tryPromise` for async operations that can fail
- Use `Data.TaggedError` for typed errors (e.g., `ConfigError`)
- Provide services via `Effect.provide(layer)`, not direct imports
- Compose layers with `Layer.merge(Layer1, Layer2)`

### CLI Pattern (from sandcastle)

```typescript
// src/cli.ts - compose commands
const rootCommand = Command.make("tool", {}, handler)
export const tool = rootCommand.pipe(Command.withSubcommands([subCmd]))
export const cli = Command.run(tool, { name: "tool", version })
```

```typescript
// src/index.ts - wire up
const mainLayer = Layer.merge(NodeContext.layer, DisplayLive)
cli(process.argv.slice(2)).pipe(Effect.provide(mainLayer), NodeRuntime.runMain)
```

### Documentation

- Every interface/type/exported function MUST have JSDoc
- Explain magic values (e.g., `schema: "1"` = MVP schema version)
- `Config.files` = mtime cache for Phase 3 (not for MVP)

## DON'Ts

### Forbidden Practices

- **NEVER use `as any`** - defeats TypeScript, hides errors
- **NEVER import `.js` files** in TypeScript - use `.ts` or no extension
- **NEVER use `Effect.sync`** for file operations (can throw) - use `Effect.try`/`Effect.tryPromise`

### Research Rule

- **When you don't know the API** → start a subagent to research
- Don't guess or use `as any` as workaround
- Read the `.d.ts` files in `node_modules` for correct types

## TDD Process

### Vertical Slices (not horizontal)

```
WRONG: test1, test2, test3 → impl1, impl2, impl3
RIGHT: test1 → impl1, test2 → impl2, test3 → impl3
```

### Test Structure

- Test behavior, not implementation
- Test through public interfaces only
- One test at a time (RED → GREEN → refactor)
- Tests should survive internal refactoring

### Documentation Requirement

- If you add/change a pattern → update this file
- If you learn something new → add to DO's or DON'Ts
- Keep it concise, not a novel

## Hexagonal Design (Goal)

### Ports & Adapters

- Domain logic in inner layer (pure functions, no dependencies)
- Ports (interfaces) define what the domain needs
- Adapters (outer layer) implement ports (e.g., FileSystem adapter)
- Dependency injection via Effect layers

### Current State

- [ ] `ConfigError` is a tagged error (good)
- [ ] `FileSystem` from `@effect/platform` (good - adapter)
- [ ] Need to extract domain logic from `store.ts`
- [ ] Need ports for: storage, embedding, scanning

## Next Steps

1. Research Effect testing best practices (subagent)
2. Implement proper integration tests for CLI
3. Refactor to hexagonal architecture
4. Document the architecture in `CONTEXT.md`
