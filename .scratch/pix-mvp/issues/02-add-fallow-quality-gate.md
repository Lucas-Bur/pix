## Parent

.scratch/pix-mvp/PRD.md

## What to build

Add `fallow` as a quality gate. Install as devDependency, add npm script, and optionally configure a pre-commit hook. After this slice, dead code, duplication, and complexity are detected automatically.

## Acceptance criteria

- [ ] `fallow` installed as devDependency (`npm install --save-dev fallow`)
- [ ] `package.json` has script `"lint:fallow": "fallow --format json"`
- [ ] Optional: pre-commit hook configured to run `fallow --summary`
- [ ] `fallow --format json` runs without errors on the project
- [ ] Documented in README or CONTRIBUTING.md

## Blocked by

None - can start immediately

Status: needs-triage
