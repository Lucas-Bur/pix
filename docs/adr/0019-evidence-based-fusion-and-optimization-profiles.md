# 0019: Evidence-based fusion and optimization profiles

## Status

Accepted (provisional DBSF rollout)

## Context

Production currently fuses five retrieval channels: Identity, CamelCase, BM25, Dense, and learned Sparse.
The schema-20 benchmark compares three fusion methods: RRF, per-channel Relative Score fusion, and
Distribution-Based Score Fusion (DBSF).
The benchmark shows that the best channel weights depend on the dense model, fusion method, query form,
and ranking evidence. A single permanently hand-tuned RRF vector cannot express those differences.

The benchmark also represents each authored intent in four forms: `identifier`, `agentTask`,
`naturalQuestion`, and `searchPhrase`. The current aggregate weights them equally, but the intended pix
usage prioritizes Search Phrase navigation when a user has a rough concept and keeps Natural Question
retrieval as a fallback for open-ended exploration.

## Decision

Keep the explicit fusion seam and evidence-based router rather than adding another channel-specific branch
to RRF. Activate DBSF as the production compatibility/default fusion based on the `search-priority` full
benchmark: fit-all R@5 is `80.7%` versus `68.7%` for Relative Score, and fit-all Context@4k is `81.3%`
versus `73.3%`. Retain RRF as an explicit historical guardrail and rollback baseline while the broader
matrix validation continues in issue #166.

Benchmarks compose production embedders and the production IndexStore with an in-memory SQLite database.
They may add fusion candidates at the `RankedChunk[]` seam, but must not reimplement production encoding,
persistence, or scoring. A fixed equal-weight RRF is always reported separately from production routing.

The router configuration will contain:

- per-channel base weights
- score-separation and score-geometry influences
- term-coverage, pairwise-agreement, and dense-confidence influences
- identifier-likelihood and query-length influences
- channel-availability handling
- a validated fusion method and optimization profile

The first benchmark optimization profile will weight query forms as:

| Query form        | Weight |
| ----------------- | -----: |
| `identifier`      |      1 |
| `agentTask`       |      2 |
| `naturalQuestion` |      3 |
| `searchPhrase`    |      4 |

The weighted objective must be applied consistently to proxy search, full candidate search, holdout
comparison, and diagnostics. Reports must retain unweighted per-query-form and per-repository metrics.
Target metrics remain explicit: Recall@5, Recall@10, Recall@20, Recall@50, and context recall at the
documented token budget. Runtime query-form labels are not inferred from benchmark labels. Production
profile selection is an explicit API/CLI choice; benchmark profile weights and evidence influences remain
evaluation objectives and require holdout evidence before they are promoted into additional runtime profiles.

Production Sparse persistence and scoring use the fixed compatibility weight documented in ADR-0020. Fusion implementation,
evidence routing, and optimization profiles are tracked in issue #163.

## Rationale

**Why retain RRF as a baseline**: It is rank-based, robust to incomparable raw score scales, and provides
a stable rollback and historical guardrail while alternative fusion methods are validated.

**Why evaluate Relative Score and DBSF**: The benchmark shows that score geometry contains useful signal
that rank-only RRF cannot use. Each method can still consume the same `RankedChunk[]` channel interface.

**Why weight query forms explicitly**: Search Phrase, Natural Question, Agent Task, and Identifier are
different product goals. A single unweighted average silently declares them equally important. The
weighted profile makes the product priority auditable while per-form holdouts prevent lower-priority
forms from being silently destroyed.

**Why keep query-form labels out of the implicit router**: Authored benchmark labels are evaluation
metadata, not reliably observable production inputs. Observable evidence can still react to exact
identifier coverage, query length, score geometry, and channel agreement. Explicit user-selected profiles
may be added later.

## Consequences

- DBSF is the active compatibility fusion; RRF remains a safe fallback and explicit benchmark baseline.
- Sparse participates in the same fusion seam with a promoted `0.1` dynamic base weight and observable
  evidence routing.
- Fusion configurations become typed, validated, and explainable rather than scattered constants.
- Every optimization result must distinguish fit-all quality from grouped and repository holdout quality.
- Weighted aggregate improvements require per-form and per-repository guardrails before production use.
