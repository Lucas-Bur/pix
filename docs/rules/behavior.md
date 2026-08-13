# Behavioral Rules for pix

## GitHub Issue Management

- When closing an issue, ALWAYS check/update acceptance criteria checkboxes `[ ]` → `[x]`
- Include summary of what was done (commits, test count, checks passed)
- Use `gh issue close --comment "..."` with checked boxes
- NEVER close an issue with unchecked boxes if work is actually done

## Documentation Requirements

- If you add/change a pattern → update relevant `docs/rules/` file
- If you learn something new → add to appropriate rules file
- Keep it concise, not a novel
- Explain magic values (e.g., `schema: "1"` = MVP schema version)
- Config interfaces must explain each field's purpose

## Toolchain Maintenance

- Use Vite+ commands for project package and quality operations; do not invoke pnpm directly.
- Keep the project and CI on the `packageManager`-pinned pnpm major.
- Keep pnpm 11 workspace settings and native-script approvals in `pnpm-workspace.yaml`.
- Run Effect diagnostics through the package scripts backed by `@effect/tsgo`; the
  `@effect/language-service` name remains only as the embedded `tsconfig.json` plugin identifier.

## Config Design

- Think through each field: what is it? why is it there?
- File observations in `IndexStore` = mtime, size, and content hash used for incremental indexing
- Document purpose and format of each field clearly

## Hexagonal Architecture (Goal)

- Domain models and contracts avoid infrastructure I/O; pure transformations remain dependency-light
- Ports (`Context.Service` in `src/domain/ports.ts`) define what the application needs
- Adapters (`src/services/`) implement ports as `Effect.Layer`
- Dependency injection via Effect layers
- Current state:
  - Ports exist for: ConfigStore, Scanner, ContentExtractor, Chunker, IdentifierExtractor, Embedder, SparseEmbedder, IndexStore, Display, Clipboard, QueryAliasStore, ModelRegistry, DeviceDetection
  - Each port has at least one live adapter; most have a test/fake adapter too
