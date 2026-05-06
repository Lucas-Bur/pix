# Correct Behavior Documentation

## Import Paths

- NEVER import `.js` files in TypeScript. Always use `.ts` extension or no extension.
- Examples: `./store.ts` or `./store`, NEVER `./store.js`

## Documentation Requirements

- Every interface, type, and exported function MUST have JSDoc documentation
- Config interfaces must explain each field's purpose
- If a field has a magic value (like schema: "1"), explain why

## Effect Error Handling

- Use Effect's typed error channels (`Effect.Effect<A, E>` not just `Effect.Effect<A>`)
- Define proper error types (e.g., `ConfigError`)
- Use `Effect.try` or `Effect.tryPromise` for side effects that can fail
- Never use `Effect.sync` for file operations that can throw

## Config Design

- Think through each field: what is it? why is it there?
- `files` in Config = mtime cache for incremental indexing (Phase 3 prep)
- Document the purpose and format of each field clearly

## Forbidden Practices

- **NEVER use `as any`** - this defeats TypeScript's type checking and hides errors
- If you resort to `as any`, you MUST research the correct solution first

## Research Rule

- When you don't know the correct API or type solution, start a subagent to research it
- Normal behavior: use subagent to find correct API usage before writing code
- Example: "Use Agent to research @effect/cli API for wiring up subcommands"

## Learnings & Patterns

- See `.claude/LEARNINGS.md` for DO's, DON'Ts, and patterns
- Update `LEARNINGS.md` when you learn something new
- Keep it concise - no novels

## GitHub Issue Management

- When closing an issue, ALWAYS check and update the acceptance criteria checkboxes `[ ]` → `[x]`
- Include a summary of what was done (commits, test count, checks passed)
- Use `gh issue close --comment "..."` with checked boxes
- Example: `- [x] Acceptance criterion met`
- NEVER close an issue with unchecked boxes if the work is actually done

## TDD & Architecture

- Follow vertical slices (RED → GREEN → REFACTOR), not horizontal
- Target: hexagonal architecture (ports & adapters)
- Document architecture decisions in `CONTEXT.md`
- Co-located tests next to source files
