# 0021: Evidence router stays multiplicative

## Status

Accepted

## Context

The production evidence router (`routeWithEvidence` in `src/lib/retrieval/evidence-router.ts`)
computes per-channel fusion weights by multiplying `baseWeights` with seven per-query evidence
factors. Issue #173 asked whether a bounded regularized log-linear gate — additive in log space —
retrieves better, and which derivative-free fitting method finds the best configuration.

The benchmark comparison (`benchmarks/retrieval/evaluation/router-search/comparisons.ts`) runs both
formulations over the same `EvidenceRouterParameters` space with four fitting methods: staged,
alternating block-coordinate, deterministic Halton restarts, and local search. Selection is
development-only; an excluded grouped fold scores the fixed winners.

First real measurement (t3code, MiniLM, DBSF, 36 development / 24 validation queries, holdout
NDCG@20; artifact `retrieval-router-model-comparison-t3code-Xenova_all-MiniLM-L6-v2.json`):

| Model                  | Best method                  | Holdout NDCG@20 |
| ---------------------- | ---------------------------- | --------------- |
| multiplicative         | staged                       | 0.6911          |
| regularized-log-linear | alternating block-coordinate | 0.6918          |

The 0.0007 gap is far below the per-query standard error (±0.01–0.04 across runs). Seven of forty
dimensions are inactive on this corpus; the searches prune them before fitting.

## Decision

- Keep the multiplicative router as the production and benchmark formulation. The log-linear gate
  stays in `comparisons.ts` as a benchmark ablation; it is not promoted.
- Keep the halving-funnel search as the production search strategy. The four comparison methods are
  recorded per run but do not replace it: none beats the funnel's holdout quality outside noise.
- Both selection rules (complexity-aware utility, one-standard-error simplicity) stay benchmark
  diagnostics. They regularly trade a small amount of holdout quality for simpler candidates.

## Rationale

A 0.0007 holdout delta with ±0.03 measurement noise is not evidence. Replacing the multiplicative
model would add a production migration (`EvidenceRouterParameters` semantics, promoted-config
re-fit) for a gain that the data cannot distinguish from zero. The multiplicative model is also the
only formulation with a promoted, validated configuration in production.

Re-run `vp run bench:retrieval:router-models` after major corpus or model changes. Promote the
log-linear gate only if it beats the multiplicative holdout by more than the combined standard
error on at least two corpora.
