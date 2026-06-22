# ADR 0012: Config Healing via ModelRegistry Port

## Status

Accepted

## Context

`.pix/config.json` can be in three states:

1. **Structurally broken** — missing fields, bad types (e.g. config written by an old pix version missing the `embedder` key)
2. **Coupled-rule violation** — fields are structurally valid but inconsistent (e.g. `dtype: "q4"` for a model that only supports `fp32/fp16/q8`)
3. **Valid** — structurally sound and coupled rules pass

Previously, structural breaks caused `ConfigValidationError` at schema decode time, and coupled violations caused `ModelLoadError` at embedder load time (much later in the pipeline). The user got errors at unpredictable points, and partial/legacy configs couldn't be auto-repaired.

Issue #68 requested a `pix config heal` command. Issue #110 requested coupling embedder config validation with the model registry. These are the same problem: "is this config internally consistent?" requires asking "what does this model allow?"

## Decision

Make `ConfigStore` a deep module that owns all three tiers of config validity:

### Structural heal

Deep-merge user config onto `DEFAULT_CONFIG` before schema decode. Missing fields are filled from defaults; bad types still fail with `ConfigValidationError`. This eliminated the `schema: "1"` version field — structural validation replaces version-based migration.

### Coupled validation via ModelRegistry port

Introduce `ModelRegistry` as a `Context.Tag` port (`src/services/models.ts`) with `get(id) → Option<ModelInfo>` and `list() → readonly string[]`. `ConfigStoreLive` depends on it via `yield* ModelRegistry`. `ModelInfo` gains a `defaultDtype` field for auto-healing unsupported dtypes.

Two outcomes:

- **Unsupported dtype** → auto-healed to `model.defaultDtype`, conflict recorded as healed
- **Unknown model** → unhealable, `ConfigHealError` with valid model options

### Three read methods

- `readConfig()` — heals silently, returns `Config`. Fails on unhealable conflicts.
- `readConfigWithConflicts()` — heals, returns `{ config, conflicts }`. Fails on unhealable. For commands that warn (`pix index`, `pix status`).
- `healConfig()` — returns `HealPlan` with all conflicts (including unhealed). Never fails on coupled issues. For `pix config heal` command.

### Only `pix config heal` writes

No command auto-persists healed config. `readConfig()` heals in memory; the on-disk config stays untouched until the user explicitly runs `pix config heal`.

### Interactive resolution via Display.select

New `Display.select(message, options, defaultValue?)` method. `pix config heal` prompts for each conflict. In `--json` mode, `Display.select` returns `defaultValue` for healed conflicts (auto-fix) and throws `InteractiveError` for unhealed conflicts. The command catches `InteractiveError` and raises `ConfigHealError` with ALL unhealed conflicts (not just the first).

## Rationale

- **Deep module**: `ConfigStore` has a thin interface (5 methods) and deep implementation (structural merge + schema decode + registry-coupled validation). Callers get a valid `Config` without knowing about merge or registry rules. Deletion test: removing this logic would scatter merge + validation across 6 call sites.
- **ModelRegistry as port**: enables testing coupled validation with a restricted fake registry (e.g. a model that only supports `fp32`). Follows the "two adapters = real seam" principle. The port is thin (`get` + `list`); the implementation is a 30-line wrapper around a static record.
- **`defaultDtype` on ModelInfo**: explicit, self-documenting, future-proofs the "q8-only model" case. Alternative was "first in dtypes list is default" — convention over configuration, but fragile.
- **Only `pix config heal` writes**: keeps `readConfig()` pure of side effects. `pix status` (read-only) can heal in memory without mutating `.pix/`. Predictable: no command silently grows the config file.
- **`--json` = non-interactive, config file is agent input**: agents are fluent at writing JSON files. `--json` mode auto-applies defaults for healable conflicts and fails with structured error for unhealable ones. Agent reads the error (includes `validOptions`), edits config, retries.

## Consequences

- **Positive**: PR #66 bug (runtime throw when `embedder` key missing) is fixed — structural heal fills it. Config errors surface at read time, not embedder load time. `pix config heal` gives users/agents a one-command repair path.
- **Negative**: `ConfigStoreLive` now depends on `ModelRegistry` — slightly larger layer graph. `Display` interface grows by one method (`select`) — three implementations must stay in sync.
- **Deferred**: `pix init` model selection prompt (#97), model-mismatch error at query time (#97), interactive `pix init --interactive` (#87).
