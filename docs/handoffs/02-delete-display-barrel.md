# Handoff: Delete `Display.ts` Barrel File

## Context

`src/display/Display.ts` is a 6-line barrel re-export file:

```typescript
export { Display } from "../domain/ports.js"
export { DisplayEntry } from "./entries.js"
export { ClackDisplay } from "./clack-display.js"
export { JsonDisplay } from "./json-display.js"
export { SilentDisplay } from "./silent-display.js"
```

It creates confusion: should consumers import from `Display.ts` or from the individual files? The barrel re-exports `Display` from `domain/ports.js` as if it belongs to the display module, which is misleading.

## Importers to Update

Find ALL files that import from `../display/Display.js` or `./display/Display.js` and update them:

| File                                | Current Import                                                                                                                                                             | New Import                                                                                                                                 |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/commands/index-cmd.ts`         | `import { Display } from "../display/Display.js"`                                                                                                                          | `import { Display } from "../domain/ports.js"`                                                                                             |
| `src/application/index-project.ts`  | `import { Display } from "../display/Display.js"`                                                                                                                          | `import { Display } from "../domain/ports.js"`                                                                                             |
| `src/lib/errors/error-format.ts`    | `import { Display } from "../../display/Display.js"`                                                                                                                       | `import { Display } from "../../domain/ports.js"`                                                                                          |
| `src/commands/query.ts`             | `import { Display } from "../display/Display.js"`                                                                                                                          | `import { Display } from "../domain/ports.js"`                                                                                             |
| `src/commands/status.ts`            | `import { Display } from "../display/Display.js"`                                                                                                                          | `import { Display } from "../domain/ports.js"`                                                                                             |
| `src/commands/reset.ts`             | `import { Display } from "../display/Display.js"`                                                                                                                          | `import { Display } from "../domain/ports.js"`                                                                                             |
| `src/commands/init.ts`              | `import { Display } from "../display/Display.js"`                                                                                                                          | `import { Display } from "../domain/ports.js"`                                                                                             |
| `src/commands/init.command.test.ts` | `import type { DisplayEntry } from "../display/Display.js"`                                                                                                                | `import type { DisplayEntry } from "../display/entries.js"`                                                                                |
| `src/cli.ts`                        | `import { ClackDisplay } from "./display/clack-display.js"` + `import { Display } from "./display/Display.js"` + `import { JsonDisplay } from "./display/json-display.js"` | Keep clack-display and json-display imports as-is, change `Display` import to `import { Display } from "./domain/ports.js"`                |
| `tests/test-utils/silentDisplay.ts` | `import { SilentDisplay } from "../../src/display/Display.js"` + `import type { DisplayEntry } from "../../src/display/Display.js"`                                        | `import { SilentDisplay } from "../../src/display/silent-display.js"` + `import type { DisplayEntry } from "../../src/display/entries.js"` |

**IMPORTANT**: Search the entire codebase with grep for `from ["'].*display/Display` to ensure NO importers are missed.

## What to Do

1. Update all importers listed above (and any others found via grep)
2. Delete `src/display/Display.ts`
3. Run `vp check --fix` to fix formatting
4. Run `vp test` to verify all tests pass
5. Run `vp run lint:fallow` to check for dead code

## Constraints

- Do NOT change any implementation code — only imports
- The `Display` port tag lives in `domain/ports.ts` — that's where it should be imported from
- `DisplayEntry` lives in `display/entries.ts`
- Implementations live in their own files: `clack-display.ts`, `json-display.ts`, `silent-display.ts`

## Files to Modify

- MODIFY: `src/commands/index-cmd.ts`
- MODIFY: `src/application/index-project.ts`
- MODIFY: `src/lib/errors/error-format.ts`
- MODIFY: `src/commands/query.ts`
- MODIFY: `src/commands/status.ts`
- MODIFY: `src/commands/reset.ts`
- MODIFY: `src/commands/init.ts`
- MODIFY: `src/commands/init.command.test.ts`
- MODIFY: `src/cli.ts`
- MODIFY: `tests/test-utils/silentDisplay.ts`
- DELETE: `src/display/Display.ts`

## Success Criteria

- `src/display/Display.ts` no longer exists
- No imports reference `display/Display.js` anywhere in the codebase
- `vp check` passes
- `vp test` passes
- `vp run lint:fallow` shows no new dead exports
