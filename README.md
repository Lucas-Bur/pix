# @lucas-bur/pix

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
