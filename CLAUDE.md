## Agent skills

### Issue tracker

Issues live as GitHub issues. See `docs/agents/issue-tracker.md`.

### Triage labels

Default label vocabulary: needs-triage, needs-info, ready-for-agent, ready-for-human, wontfix. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context repo: one `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.

## Using Vite+, the Unified Toolchain for the Web

This project is using Vite+, a unified toolchain built on top of Vite, Rolldown, Vitest, tsdown, Oxlint, Oxfmt, and Vite Task. Vite+ wraps runtime management, package management, and frontend tooling in a single global CLI called `vp`. Vite+ is distinct from Vite, and it invokes Vite through `vp dev` and `vp build`. Run `vp help` to print a list of commands and `vp <command> --help` for information about a specific command.

Docs are local at `node_modules/vite-plus/docs` or online at https://viteplus.dev/guide/.

### Command equivalents (NEVER use pnpm directly)

| Instead of...       | Use...            |
| ------------------- | ----------------- |
| `pnpm install`      | `vp install`      |
| `pnpm add <pkg>`    | `vp add <pkg>`    |
| `pnpm add -D <pkg>` | `vp add -D <pkg>` |
| `pnpm run <script>` | `vp run <script>` |
| `pnpm test`         | `vp test`         |
| `pnpm build`        | `vp run build`    |

### Quality Pipeline

Every change must pass three quality gates before marking work as complete:

1. **`vp check`** (mandatory) — Format, lint, type check. Fix errors with `vp check --fix`.
2. **`vp test`** — Run all tests. All tests must be green.
3. **`vp run lint:fallow`** — Code quality gate via fallow (duplication, dead code, complexity).

Run them in order: `vp check && vp test && vp run lint:fallow`.

### Review Checklist

- [ ] Run `vp install` after pulling remote changes and before getting started.
- [ ] Run `vp check`, `vp test`, and `vp run lint:fallow` — all quality gates must pass.
- [ ] Check if there are `vite.config.ts` tasks or `package.json` scripts necessary for validation, run via `vp run <script>`.

## Effect-TS Guidelines

When working with code that imports from `effect`, **invoke the `/effect-ts` skill** before starting implementation. It provides detailed patterns, reference docs, and critical rules.

Follow these mandatory guidelines (as enforced by the skill):

### Prerequisites Check

Before starting any Effect-related work, verify the Effect-TS source code exists at `~/.effect`. If missing, stop and inform the user to clone it:
```bash
git clone https://github.com/Effect-TS/effect.git ~/.effect
```

### Research Strategy

Effect-TS has many ways to accomplish the same task. Research before implementing:

1. **Codebase Patterns First** — Examine similar patterns in the current project. Follow existing conventions.
2. **Effect Source Code** — For complex type errors or unclear behavior, check `~/.effect/packages/effect/src/`.

Spawn research agents for HIGH priority tasks: Services/Layers, error handling with multiple error types, Stream operations, resource management, concurrent operations, testing patterns.

### Critical Rules (Mandatory)

**INEFFECTIVE: try-catch in Effect.gen**
Effect failures are returned as exits, not thrown as JavaScript exceptions. Using try-catch will not catch Effect failures.

**AVOID: Type Assertions**
Avoid `as never`, `as any`, `as unknown`. Fix underlying type issues instead.

**RECOMMENDED: `return yield*` for Errors**
Use `return yield*` when yielding errors or interrupts in Effect.gen for clarity and explicit termination.

**Null vs Option\<T> Rule**
Use `Option<T>` internally, `T | null` at boundaries (React state/props, JSON serialization, external APIs).

### Effect Principles

- **Error Handling**: Use Effect's typed error system (`Effect.fail`, `Effect.catchTag`, `Effect.catchAll`). Define errors with `Data.TaggedError`.
- **Dependency Injection**: Use Services (`Context.Tag`) and Layers (`Layer.merge`, `Layer.provide`). Prefer `Effect.Service` for bundled implementation (3.16.0+).
- **Composability**: Use `Effect.gen` for readable sequential code. Prefer `Effect.fn()` for named functions (automatic telemetry/tracing).
- **Testing**: Use `@effect/vitest`. Remember `it.effect` uses `TestClock` — time starts at 0 and doesn't pass unless advanced with `TestClock.adjust()`. Use `it.live` for wall-clock time.

### Quick Reference

```typescript
// Creating Effects
Effect.succeed(value) | Effect.fail(error) | Effect.tryPromise(fn) | Effect.try(fn)

// Composing
Effect.flatMap(effect, fn) | Effect.map(effect, fn) | Effect.tap(effect, fn) | Effect.all([...effects])

// Error Handling
class MyError extends Data.TaggedError("MyError")<{ detail: string }> {}
Effect.catchTag(effect, "MyError", fn) | Effect.catchAll(effect, fn)

// Services
class MyService extends Context.Tag("MyService")<MyService, { ... }>() {}
const MyServiceLive = Layer.succeed(MyService, { ... })

// Duration (human-readable strings preferred)
Effect.retry(effect, Schedule.exponential("100 millis"))
```

### Stream Safety

Always bound consumption of streams. Infinite streams hang on `Stream.runCollect()`:
```typescript
// RIGHT: bound consumption
yield* Stream.runCollect(Stream.take(infiniteStream, 100))
yield* Stream.runCollect(stream.pipe(Effect.timeout("5 seconds")))
```
