## Parent

.scratch/pix-mvp/PRD.md

## What to build

Add `fallow` as a quality gate. Install as devDependency, add npm script, and optionally configure a pre-commit hook. After this slice, dead code, duplication, and complexity are detected automatically.

## Acceptance criteria

- [x] `fallow` installed as devDependency (`vp add -D fallow`)
- [x] `package.json` has script `"lint:fallow": "fallow --format json"`
- [ ] Optional: pre-commit hook configured to run `fallow audit --summary`
- [x] `fallow --format json` runs without errors on the project (exit code 0)
- [x] Documented in README

## Blocked by

None - can start immediately

Status: done
