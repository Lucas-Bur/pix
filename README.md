# @lucas-bur/pix

[![CI](https://github.com/Lucas-Bur/pix/actions/workflows/ci.yml/badge.svg)](https://github.com/Lucas-Bur/pix/actions/workflows/ci.yml)
[![codecov](https://codecov.io/gh/Lucas-Bur/pix/graph/badge.svg)](https://codecov.io/gh/Lucas-Bur/pix)
[![fallow health](https://raw.githubusercontent.com/Lucas-Bur/pix/badges/health.svg)](https://github.com/Lucas-Bur/pix/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/@lucas-bur/pix)](https://www.npmjs.com/package/@lucas-bur/pix)
[![npm downloads](https://img.shields.io/npm/dm/@lucas-bur/pix)](https://www.npmjs.com/package/@lucas-bur/pix)

Lightweight local semantic project indexer. Zero external services, 100% local and offline. Installs as a devDependency and provides agent-ready structured JSON output.

## Quick Start

```bash
npm install --save-dev @lucas-bur/pix
pix init
pix index
pix query "authentication middleware"
```

## Commands

| Command              | Description                                 | JSON flag |
| -------------------- | ------------------------------------------- | --------- |
| `pix init`           | Create `.pix/config.json` with defaults     | `--json`  |
| `pix index`          | Scan, chunk, embed, and store project files | `--json`  |
| `pix query "<text>" [flags]` | Semantic search via cosine similarity (`--top`, `--context-lines`, `--ignore-path`, `--only-path`, `--max-characters`, `--no-content`) | `--json`  |
| `pix status`         | Show index statistics                       | `--json`  |
| `pix reset`          | Delete index files (chunks + vectors)       | `--json`  |

All commands support `--json` for structured output on stdout — ideal for piping to AI agents.

## Agent-Ready Output

```bash
$ pix status --json
{"chunks":59,"files":37,"model":"Xenova/all-MiniLM-L6-v2","lastIndex":1715030400000,"totalLines":1260,"byteSize":16128}
```

Errors use the same structured format:

```json
{ "error": true, "code": "CONFIG_MISSING", "message": "No .pix/config.json found" }
```

## Architecture

pix follows hexagonal architecture (ports and adapters) with three layers:

- **Domain** (`src/domain/`) — Pure types, entities, port declarations
- **Application** (`src/application/`) — Use cases orchestrating business logic
- **Infrastructure** (`src/services/`) — Concrete adapters (ONNX, filesystem, ffmpeg scanning)

See [CONTEXT.md](./CONTEXT.md) for architecture decisions and [docs/adr/](./docs/adr/) for decision records.

## Quality

- `vp check` — Format, lint, type-check
- `vp test` — Unit and integration tests
- `vp run lint:fallow` — Dead code, duplication, complexity analysis

## License

[MIT](./LICENSE)
