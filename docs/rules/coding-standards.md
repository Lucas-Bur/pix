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
- Attach each command's services with `Command.provide`. Keep command-layer modules behind
  `loadLayer(() => import(...))`: layers build lazily, but static ESM imports still load eagerly and regress CLI startup.
- Co-located tests: `<file>.test.ts` next to source
- Low-level SQLite migration/schema tests that need raw SQL use `<file>.migration.test.ts` as an explicit exception to the public-interface-only test rule.

## CLI Packaging

- Dependencies fully bundled by `vp pack` stay in `devDependencies`; packages imported by the
  generated `dist` files belong in `dependencies`.
- Native or platform-selected packages must remain external and be verified through an npm tarball
  installed in a clean project.
- A singleton runtime and adapters that exchange its values must share one bundle boundary: bundle
  them together or externalize them together. Never leave an adapter external when its peer runtime
  is bundled.
- Native dependencies with install scripts, including transitive ones, must be explicitly enabled
  in `pnpm-workspace.yaml#allowBuilds` and verified with a clean pnpm 11 install.
- Fallow analyses source imports, not Vite+ bundle boundaries, so bundled dev dependencies can appear
  as `dev dependencies used in production`. Do not move them solely to silence that finding. The PR
  regression gate is `vp run lint:fallow:ci`; the full `vp run lint:fallow` remains the health report.

## Simplicity and Derivation

- Prefer less code over defensive abstraction. Add a helper, factory, interface, or type only when it removes real duplication across current call sites.
- Do not introduce single-use factories or wrapper helpers around one-liners. Inline direct library calls when that matches nearby code.
- Keep command files close to the existing command style: declare CLI config, call services/use cases, handle display/errors. Shared behavior belongs in a small sibling module, not by importing one command from another.
- Derive types from the source of truth instead of writing parallel interfaces. For CLI input, derive from `Command.Command.Config.Infer<typeof config>`. For persisted JSON, derive from `Schema` definitions.
- At filesystem and process boundaries, validate owned data with `Schema`. Do not hand-roll JSON shape checks when an Effect Schema can define the boundary and provide the type.
- Avoid maintaining the same option fields in several places. If query flags, alias persistence, and execution need the same fields, expose the smallest shared config/schema and derive the rest.
- Runtime-only flags such as output mode should stay runtime-only. Do not persist them unless the domain explicitly says they are part of the saved concept.
- Do not suppress `fallow` findings to make gates pass. Complexity reports are architectural signals and must stay visible unless the code is actually refactored.
- Before extracting code, apply the deletion test: if deleting the abstraction makes the code clearer and does not duplicate meaningful behavior, the abstraction should not exist.

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

- Access services from the Effect environment inside Effect workflows. Pass services as function parameters only for pure helpers or deliberately dependency-free functions.
- Prefer named reusable effects only when they are reused or clarify a workflow. Do not wrap a single inline operation in a local `() => Effect...` function just to call it once.
- Use `Effect.fn` for named, reusable workflows where tracing/diagnostics or a stable semantic boundary help. Do not use it as ceremony for trivial one-off local code.
- If an effect does not need runtime parameters and is used once, inline it. If it needs parameters, a plain function returning `Effect` is fine.

### Schema Patterns for Effect Schema

Use `Schema.Struct` with inferred types (no duplicate interfaces):

```typescript
const MySchema = Schema.Struct({ ... })
type MyType = typeof MySchema.Type
```

| Desired behavior            | Schema pattern                                                                   | Example                             | Use when                                                   |
| --------------------------- | -------------------------------------------------------------------------------- | ----------------------------------- | ---------------------------------------------------------- |
| Required, non-null          | `Schema.String`                                                                  | `name: string`                      | Field must always be present and have a real value         |
| Optional, non-null          | `Schema.optional(Schema.String)`                                                 | `name?: string`                     | Field may be omitted, but if present must be a string      |
| Required, nullable          | `Schema.Union(Schema.String, Schema.Null)`                                       | `name: string \| null`              | Key must exist, but value may explicitly be null           |
| Optional + nullable         | `Schema.optional(Schema.Union(Schema.String, Schema.Null))`                      | `name?: string \| null`             | Field may be missing, and if present can be string or null |
| Optional with exact typing  | `Schema.optionalWith(Schema.String, { exact: true })`                            | `chunkConcurrency?: number` (exact) | Precise optional-field typing/encoding (config fields)     |
| Optional + nullable + exact | `Schema.optionalWith(Schema.Union(Schema.String, Schema.Null), { exact: true })` | `note?: string \| null` (exact)     | Both missing-key support and exact optional semantics      |

Config validation is strict (`optionalWith` + `exact: true`). Chunk validation is non-blocking (skip malformed lines, return errors in the success value).
Use `Schema.Finite` for domain, transport, and persisted numbers unless `NaN` or infinity is an
explicit part of the model. Layer integer or range checks on that finite base.

### Effect Tooling

- Vite+ remains the runner and primary `vp check` toolchain.
- TypeScript 7 provides the native TypeScript-Go compiler and language server binary.
- `@effect/tsgo` supplies Effect diagnostics; run them through `vp run lint:effect*`.
- Keep the `tsconfig.json` plugin name `@effect/language-service`; it is the internal plugin
  identifier expected by `@effect/tsgo`, not an npm dependency.
- Use `@effect/vitest` test APIs for Effect-returning tests. Import `vi` from `vitest` where static
  `vi.mock` transformation requires the canonical Vitest module.

### Error Propagation in Services

When a use case delegates to a port method with errors in its type (e.g., `IndexStore.getStatus() → PlatformError`), the use case method must also declare those errors:

```typescript
// WRONG: use case declares never, but port has PlatformError
const getStatus = (): Effect.Effect<StatusResult, never> => ...

// RIGHT: use case mirrors the port's error type
const getStatus = (): Effect.Effect<StatusResult, PlatformError> => ...
```

## @effect/platform Quirks

- `FileSystem.Info.mtime` is `Option<Date>`, not `Date | undefined` — use `Option.map` to extract
- `FileSystem.Info.size` may be a branded `Size` type, not plain `number` — use the platform-provided numeric conversion at the boundary.

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
- Read `node_modules/effect/AGENTS.md` when the installed version provides it; otherwise inspect
  `node_modules/effect/src/` for Effect API details
