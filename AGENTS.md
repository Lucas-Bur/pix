Load and follow ALL rules in `docs/rules/` before any action. No exceptions.

## Agent skills

### Issue tracker

Issues live as GitHub issues. See `docs/agents/issue-tracker.md`.

### Triage labels

Default label vocabulary: needs-triage, needs-info, ready-for-agent, ready-for-human, wontfix. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context repo: one `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.

### Additional Guidelines

- Coding standards & patterns: @docs/rules/coding-standards.md
- Behavioral rules: @docs/rules/behavior.md
- Project context: @CONTEXT.md

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

When working with code that imports from `effect`, **invoke the `/effect-ts` skill** before starting implementation.

Follow the coding standards in `@docs/rules/coding-standards.md` for Effect-TS patterns, TypeScript rules, and TDD process.

### Learning More About Effect

Before writing Effect code, read `node_modules/effect/AGENTS.md` completely when the installed
Effect version provides it, and follow its linked guidance. If it is absent, use the installed source
under `node_modules/effect/src` together with this repository's rules; do not require a separate
`~/.effect` checkout.

### Stream Safety

Always bound consumption of streams. Infinite streams hang on `Stream.runCollect()`:

```typescript
// RIGHT: bound consumption
yield * Stream.runCollect(Stream.take(infiniteStream, 100))
yield * Stream.runCollect(stream.pipe(Effect.timeout("5 seconds")))
```

## Using `pix query` for Retrieval

`pix` is an **exploration tool**, not a precision tool. Use it to find files, not to extract content.

### Strategy

1. **1-2 pix queries to locate relevant files** — Use `--no-content` to get file:line references only, saving tokens.
2. **Then `read` the found files** for exact code, error types, and implementation details.
3. **Only use grep/read for follow-up precision** — grep for specific identifiers, read the target file.

### Recommended Flags

```bash
pix query --json --top 5 --no-content "<semantic description>"
```

- `--json` — structured output, parseable by agents
- `--top 5` — enough candidates without flooding
- `--no-content` — file:line only, saves tokens; then `read` the file

### Anti-Patterns

- **Don't spray 10+ queries** — 2 good queries + read beats 10 queries
- **Don't rely on pix for full content** — it returns raw chunk text, inflating tokens
- **Don't use pix for exact identifier lookup** — grep is cheaper and more precise
- **Don't skip grep/read** — combine pix (find) + read (examine) for the best ratio
