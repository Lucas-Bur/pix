# @lucas-bur/pix

[![CI](https://github.com/lucas-bur/pix/actions/workflows/ci.yml/badge.svg)](https://github.com/lucas-bur/pix/actions/workflows/ci.yml)
[![codecov](https://codecov.io/gh/lucas-bur/pix/branch/main/graph/badge.svg)](https://codecov.io/gh/lucas-bur/pix)
[![npm version](https://img.shields.io/npm/v/@lucas-bur/pix)](https://www.npmjs.com/package/@lucas-bur/pix)
[![npm downloads](https://img.shields.io/npm/dm/@lucas-bur/pix)](https://www.npmjs.com/package/@lucas-bur/pix)
[![Code Quality](https://img.shields.io/badge/code%20quality-fallow-blue)](https://github.com/fallow-rs/fallow)

Lightweight local semantic project indexer (short pix)

Zero external services, 100% local + offline. Installs as a devDependency and provides agent-ready structured JSON output.

## Status

MVP in development. See [CONTEXT.md](./CONTEXT.md) for architecture decisions and [.scratch/pix-mvp/PRD.md](./.scratch/pix-mvp/PRD.md) for the product requirements.

## Quick Start

```bash
npm install --save-dev @lucas-bur/pix
pix init
pix index
pix query "authentication middleware"
```

## Quality Gates

This project uses [fallow](https://github.com/fallow-rs/fallow) for static analysis (dead code, duplication, complexity).

### Commands

- `vp run lint:fallow` — Run fallow with JSON output (used in CI)
- `fallow audit --summary` — Check only changed files (used in pre-commit hook)

### Pre-commit Hook

The pre-commit hook is managed by vite-plus and runs:

1. `vp staged` — Formats, lints, and type-checks staged files
2. `fallow audit --summary` — Audits changed files for quality issues

To set up hooks after cloning: `vp config`

## License

[MIT](./LICENSE)
