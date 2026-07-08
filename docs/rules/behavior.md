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

## Config Design

- Think through each field: what is it? why is it there?
- `files` in Config = mtime cache for incremental indexing (Phase 3 prep)
- Document purpose and format of each field clearly

## Hexagonal Architecture (Goal)

- Domain logic in inner layer (pure functions, no dependencies)
- Ports (`Context.Tag` in `src/domain/ports.ts`) define what the application needs
- Adapters (`src/services/`) implement ports as `Effect.Layer`
- Dependency injection via Effect layers
- Current state:
  - Ports exist for: ConfigStore, Scanner, ContentExtractor, Chunker, IdentifierExtractor, Embedder, IndexStore, Display, Clipboard, QueryAliasStore, ModelRegistry, DeviceDetection
  - Each port has at least one live adapter; most have a test/fake adapter too
