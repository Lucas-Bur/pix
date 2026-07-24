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

| Command                      | Description                                                                                                                            | JSON flag |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| `pix init`                   | Create `.pix/config.json` with defaults                                                                                                | `--json`  |
| `pix index`                  | Scan, chunk, embed, and store project files                                                                                            | `--json`  |
| `pix query "<text>" [flags]` | Semantic search via cosine similarity (`--top`, `--context-lines`, `--ignore-path`, `--only-path`, `--max-characters`, `--no-content`) | `--json`  |
| `pix mcp`                    | Run the host-managed MCP stdio server with the same retrieval options as `pix query`                                                   | —         |
| `pix status`                 | Show index statistics                                                                                                                  | `--json`  |
| `pix reset`                  | Delete index files (chunks + vectors)                                                                                                  | `--json`  |

All one-shot commands support `--json` for structured output on stdout — ideal for piping to AI agents.

## MCP Server

The installed `pix` executable includes a local MCP server. An MCP host starts `pix mcp` as a child
process, communicates over stdio, and stops it by closing stdin. The server uses the host's working
directory, refreshes that project's index before each query, and does not run as a detached daemon.

The server exposes `query`, `status`, `index`, `alias_list`, `alias_add`, `alias_remove`, and
`alias_run`. Query and alias-run share the same retrieval options as the CLI. Reset, cache clearing,
initialization, and config healing are intentionally not exposed through MCP.

After installing pix globally, add it to any MCP client. All clients use the same stdio shape — just the config file location differs.

**Standard format** (`mcpServers`):

| Client         | Config file                           |
| -------------- | ------------------------------------- |
| Claude Desktop | `claude_desktop_config.json`          |
| Cursor         | `.cursor/mcp.json` (project-local)    |
| Windsurf       | `~/.codeium/windsurf/mcp_config.json` |
| Cline          | `~/.cline/mcp_settings.json`          |

```json
{
  "mcpServers": {
    "pix": {
      "command": "pix",
      "args": ["mcp"]
    }
  }
}
```

**OpenCode** uses a different key layout — `~/.config/opencode/config.json`:

```json
{
  "mcp": {
    "pix": {
      "type": "local",
      "command": ["pix", "mcp"],
      "enabled": true
    }
  }
}
```

Restart the MCP host after changing its configuration. Each workspace gets its own MCP process and uses
its own `.pix/index.db`. SQLite uses WAL mode, so keeping the MCP connection open does not
permanently lock the database against normal CLI reads.

## Agent-Ready Output

```bash
$ pix status --json
{"chunks":59,"files":37,"model":"Xenova/all-MiniLM-L6-v2","lastIndex":1715030400000,"totalLines":1260,"byteSize":16128}
```

Errors use the same structured format:

```json
{
  "error": true,
  "code": "CONFIG_NOT_FOUND",
  "message": "No .pix/config.json found",
  "cause": "..."
}
```

## Architecture

pix follows hexagonal architecture (ports and adapters) with three layers:

- **Domain** (`src/domain/`) — Pure types, entities, port declarations
- **Application** (`src/application/`) — Use cases orchestrating business logic
- **Infrastructure** (`src/services/`) — Concrete adapters (filesystem, ONNX models, gitignore-based scanning)

See [CONTEXT.md](./CONTEXT.md) for architecture decisions and [docs/adr/](./docs/adr/) for decision records.

## Quality

- `vp check` — Format, lint, type-check
- `vp test` — Unit and integration tests
- `vp run lint:fallow` — Dead code, duplication, complexity analysis

## License

[MIT](./LICENSE)
