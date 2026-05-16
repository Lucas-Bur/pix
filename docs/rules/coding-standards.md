# Coding Standards for pix

## TypeScript Rules

- NO `as any`, `as never`, `as unknown` — fix underlying types
- Use `Option<T>` internally, `T | null` at boundaries (React state/props, JSON, external APIs)
- Every interface, type, and exported function MUST have JSDoc
- Use `.js` extension in TypeScript imports (required by `moduleResolution: nodenext`) — not `.ts`

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
- Compose layers with `Layer.merge(Layer1, Layer2)` or `Layer.provideMerge(L1, L2)` (takes exactly 2 args — chain for more)
- Never use try-catch in Effect.gen — Effect failures are returned as exits
- Never use `Effect.sync` for file operations — use `Effect.try`/`Effect.tryPromise`
- Use `return yield*` when yielding errors or interrupts in Effect.gen
- NEVER use `Effect.log*` — errors must flow through return types or the error channel

### Schema Patterns for Effect Schema

Use `Schema.Struct` with inferred types (no duplicate interfaces):

```typescript
const MySchema = Schema.Struct({ ... })
type MyType = typeof MySchema.Type
```

| Desired behavior            | Schema pattern                                                                   | Example                 | Use when                                                   |
| --------------------------- | -------------------------------------------------------------------------------- | ----------------------- | ---------------------------------------------------------- |
| Required, non-null          | `Schema.String`                                                                  | `name: Schema.String`   | Field must always be present and have a real value         |
| Optional, non-null          | `Schema.optional(Schema.String)`                                                 | `name?: string`         | Field may be omitted, but if present must be a string      |
| Required, nullable          | `Schema.Union(Schema.String, Schema.Null)`                                       | `name: string \| null`  | Key must exist, but value may explicitly be null           |
| Optional + nullable         | `Schema.optional(Schema.Union(Schema.String, Schema.Null))`                      | `name?: string \| null` | Field may be missing, and if present can be string or null |
| Optional with exact typing  | `Schema.optionalWith(Schema.String, { exact: true })`                            | advanced optional shape | Precise optional-field typing/encoding (config fields)     |
| Optional + nullable + exact | `Schema.optionalWith(Schema.Union(Schema.String, Schema.Null), { exact: true })` | advanced form           | Both missing-key support and exact optional semantics      |

Config validation is strict (`optionalWith` + `exact: true`). Chunk validation is non-blocking (skip malformed lines, return errors in the success value).

### Error Propagation in Services

When a use case delegates to a port method with errors in its type (e.g., `VectorStore.getStatus() → PlatformError`), the use case method must also declare those errors:

```typescript
// WRONG: use case declares never, but port has PlatformError
const getStatus = (): Effect.Effect<StatusResult, never> => ...

// RIGHT: use case mirrors the port's error type
const getStatus = (): Effect.Effect<StatusResult, PlatformError> => ...
```

## @effect/platform Quirks

- `FileSystem.Info.mtime` is `Option<Date>`, not `Date | undefined` — use `Option.map` to extract
- `FileSystem.Info.size` may be a branded `Size` type, not plain `number` — cast via `unknown` first: `size as unknown as number`

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
