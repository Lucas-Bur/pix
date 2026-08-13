# ADR 0007: Display Service Pattern

## Status

Accepted

## Context

The CLI needs to support two output modes (human-interactive and machine-readable JSON) plus a third mode for test assertions. Early code used `console.log` scattered across commands, making it impossible to test CLI output or switch between human and JSON mode.

## Decision

Introduce a `Display` context service (`Context.Service`) with three implementations:

- **ClackDisplay** — renders via `@clack/prompts` with spinners, styled text, frames for human mode
- **JsonDisplay** — no-ops interactive elements, writes structured JSON to stdout for --json mode
- **SilentDisplay** — records all calls to a `Ref<DisplayEntry[]>` for test assertions

All CLI output goes through `yield* Display.method()`. Commands call all methods unconditionally — no `if (json)` branching.

State management for exclusive spinner/progress bar access is extracted into `src/display/interactive-state.ts` as a pure state machine.

Output separation: ClackDisplay's `json()` is a no-op; JsonDisplay's interactive methods are no-ops. Each Display handles its own surface. Error output uses `reportError` which calls both `d.log(..., "error")` and `d.json(error)` — ClackDisplay renders the log, JsonDisplay emits the JSON.

Infrastructure code uses the `Display` service only where it must report user-facing progress or
warnings; other adapters remain independent of presentation concerns.

## Rationale

The three-implementation approach was chosen to make every CLI output path testable: test assertions assert against `SilentDisplay`'s `DisplayEntry` tagged union rather than parsing stdout. Separating interactive (Clack) from machine-readable (Json) output through the same `Display` port means every command supports both modes without `if (json)` branching. The trade-off is increased maintenance surface — three implementations must be kept in sync as new output methods are added — but this is offset by the elimination of untested console.log paths.

## Consequences

- Tests assert on structured DisplayEntry tagged enums instead of parsing stdout
- Adding a new command automatically supports both human and JSON mode
- The 3-impl pattern adds maintenance surface but ensures testability
- Infrastructure code stays free of UI dependencies unless it explicitly reports operational progress through `Display`
