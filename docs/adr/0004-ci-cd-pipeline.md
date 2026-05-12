# CI/CD Pipeline

## Status

Accepted

## Context

pix had no CI pipeline, no automated testing gate, no changelog, and no automated release process.
Version management was manual via `bumpp` (since removed). Badges and quality metrics were absent.
We needed a pipeline that:

- Gates merges on quality (format, lint, type-check, test, build)
- Surfaces Effect code quality diagnostics (non-blocking `@effect/language-service`)
- Provides code quality metrics non-blockingly
- Automates versioning and changelog generation
- Publishes to npm on release
- Works with the Vite+ toolchain (`vp`, `vpx`)
- Adds automated PR review for open source

## Decision

### Quality gate (`ci.yml`)

Trigger: PR to `main`. Sequential pipeline:

1. `vp install` — install dependencies
2. `vp run check` — format, lint, type-check via `package.json#scripts.check` (blocking)
3. `vp run test:coverage` — run tests with V8 coverage via `package.json#scripts.test:coverage` (blocking)
4. `vp run build` — production build via `package.json#scripts.build` (blocking)
5. `vp run lint:effect:ci` — Effect diagnostics, emits `::notice` annotations on PR diffs (non-blocking, `continue-on-error: true`)
6. `vp run lint:fallow:ci` — incremental code quality audit against `main`, badge format (non-blocking, `continue-on-error: true`)

Both non-blocking steps include crash instrumentation: a subsequent `if: failure()` step
emits a `::warning` if the tool itself crashed (as opposed to merely reporting findings),
preventing silent failures from `continue-on-error: true`.

**Script orchestration pattern**: `ci.yml` contains zero inline command strings — every
step is `vp run <script>`. The actual commands live in `package.json` as the single source
of truth. Consumer-facing format variants use `:ci` and `:agent` suffixes:

| Script              | Consumer | Format                    |
| ------------------- | -------- | ------------------------- |
| `lint:effect`       | Human    | pretty                    |
| `lint:effect:ci`    | CI       | github-actions            |
| `lint:effect:agent` | Agent    | json                      |
| `lint:fallow`       | Human    | default                   |
| `lint:fallow:ci`    | CI       | badge (incremental audit) |
| `lint:fallow:agent` | Agent    | json                      |

A convenience `ci` script is available for humans: `vp run check && vp run test:coverage && vp run build && vp run lint:effect && vp run lint:fallow`.

Vite+ provides `voidzero-dev/setup-vp@v1` which handles Node.js version, pnpm setup,
and dependency caching in a single action — replacing `setup-node`, `pnpm/action-setup`, and
`actions/cache`.

### Automated release (`release-please.yml`)

Trigger: push to `main`. Uses `googleapis/release-please-action@v4` to:

- Scan conventional commits since last release
- Determine semver bump (`feat:` → minor, `fix:` → patch, `feat!:`/`BREAKING CHANGE:` → major)
- Open a release PR with version bump + generated changelog in `CHANGELOG.md`
- On merge: create git tag + GitHub Release

### Publish (`publish.yml`)

Trigger: release published. Installs dependencies, runs `prepublishOnly` hook (which
builds via `vp pack`), publishes to npm.

### PR review

CodeRabbit installed via GitHub Marketplace for automated PR review. Config via
`.coderabbit.yaml`.

### Branch protection

`main` requires PR + CI green. No direct pushes.

### Badges

README displays: CI status, coverage (via Codecov), fallow metrics (static), npm version
(shields.io), npm downloads (shields.io).

## Rationale

- **Vite+ native**: `setup-vp` handles Node + pnpm + caching in one step; avoids multi-action
  boilerplate
- **Blocking vs. non-blocking**: `vp run check`, `vp run test:coverage`, and `vp run build`
  block merges; Effect diagnostics and fallow audit run informatively so low-severity findings
  don't stall progress. Crash instrumentation prevents `continue-on-error: true` from masking
  tool failures.
- **Script-as-truth**: ci.yml references `package.json` scripts exclusively via `vp run <script>`.
  Zero inline command duplication — no drift possible between CI and local development.
- **Effect diagnostics**: `@effect/language-service` (configured via `tsconfig.json` plugins)
  surfaces Effect-specific issues like `preferSchemaOverJson`, `unnecessaryFailYieldableError`,
  and `effectSucceedWithVoid`. Uses `--format github-actions` so each finding appears as an
  inline annotation on the relevant PR diff line.
- **release-please**: Zero-config after install, native GitHub Action, conventional commits
  already used by the project. No local tooling or npm token needed for release management
- **Codecov**: Free for open source, minimal config, native vitest integration
- **Manual release timing**: Release is gated on merging the release-please PR — the
  maintainer controls when a version ships

## Consequences

- **Positive**: Every PR is quality-checked automatically; no broken code reaches `main`
- **Positive**: Changelog and version numbers stay current without manual effort
- **Positive**: CodeRabbit provides AI review on every PR at no cost
- **Negative**: Requires `NPM_TOKEN` secret for publish workflow
- **Negative**: Requires Codecov token (unless using tokenless upload for public repos)
- **Negative**: Conventional commit discipline required for correct semver bumps
