# 0023: Production router defaults and benchmark cleanup

## Status

Accepted (execution tracked below)

## Context

The #166 evidence chain settled the search method (halving funnel), the fusion method (DBSF), and
the router formulation (multiplicative, ADR 0021). Production always executes the evidence router
(`routeWithEvidence` in `src/application/query-project.ts:108`); there is no static fallback path.
Remaining questions: which parameters production should carry, whether they need per-model variants,
and which benchmark alternatives can now be deleted.

## Decisions

### Production

- **The evidence router stays the only production retrieval path.** No static-weight fallback
  exists or comes back. Confirmed, no code change.
- **DBSF stays the only production fusion.** RRF and relative-score remain benchmark comparison
  axes; the production `fusion` field keeps decoding them for artifact compatibility but no
  promoted config or profile uses them.
- **Promotion target: per-profile and per-model router configs.** Today all four production
  profiles alias `PROMOTED_SEARCH_PRIORITY_CONFIG` (TODO(#163) placeholder), and the config is
  model-independent. The benchmark already fits per model and per optimization profile, so the
  gap is production-side only: `PRODUCTION_PROFILES` entries get their own benchmark-fitted
  configs, and the promoted config becomes keyed by embedder model with the current config as
  fallback. No schema versioning on the production config (per #166).
- **Promotion gate:** a matrix release run (`vp run bench:retrieval:matrix`) must show the
  per-profile/per-model candidate meeting guardrails on its coordinate before the constant swaps.
  This is the same evidence standard the current config passed.

### Benchmark cleanup

- **Delete `successive-halving`.** It is the superseded historical control; `proxy-promotion`
  remains the documented slow control for funnel re-validation. Touches strategy types, the rank
  mode, the `PIX_BENCH_ROUTER_STRATEGY` knob, and tests that use it as a fixture.
- **Delete the legacy per-query-kind RRF grids and Shapley diagnostics** (`legacyDiagnostics`).
  They are already off by default and serve no control role.
- **Keep the static fusion search.** It is the control that proves dynamic beats static — the
  basis of every promotion claim. It stays in the full profile only.
- **Keep RRF and relative-score in the benchmark** as comparison axes. Deleting them would make
  the DBSF decision unmeasurable in future re-runs.

## Rationale

Controls that justify a decision stay; controls that merely replay history go. The funnel was
adopted over proxy-promotion with measured evidence, so proxy-promotion keeps earning its place as
the slow control, while successive-halving no longer answers any live question. Per-model configs
follow the same evidence logic as ADR 0022's index-size finding: model identity and profile intent
are index-level priors, and the benchmark produces the per-cell evidence already.

## Execution order

1. Benchmark cleanup: remove `successive-halving` and legacy diagnostics (schema bump).
2. Matrix release run for per-profile/per-model promotion evidence.
3. Swap production constants: distinct profile configs, model-keyed promoted config with fallback.
