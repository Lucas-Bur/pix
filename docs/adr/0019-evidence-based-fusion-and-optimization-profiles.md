# 0019: Evidence-based fusion and optimization profiles

## Status

Proposed

## Context

Production currently fuses five retrieval channels with weighted Reciprocal Rank Fusion (RRF): Identity,
CamelCase, BM25, Dense, and learned Sparse. The schema-19 benchmark compares three
fusion methods: RRF, per-channel Relative Score fusion, and Distribution-Based Score Fusion (DBSF).
The benchmark shows that the best channel weights depend on the dense model, fusion method, query form,
and ranking evidence. A single permanently hand-tuned RRF vector cannot express those differences.

The benchmark also represents each authored intent in four forms: `identifier`, `agentTask`,
`naturalQuestion`, and `searchPhrase`. The current aggregate weights them equally, but the intended pix
usage prioritizes Search Phrase navigation when a user has a rough concept and keeps Natural Question
retrieval as a fallback for open-ended exploration.

## Decision

Keep RRF as the production compatibility/default fusion until an alternative passes the documented
holdout guardrails. Add an explicit fusion seam and an evidence-based router rather than adding another
channel-specific branch to RRF.

Benchmarks compose production embedders and the production IndexStore with an in-memory SQLite database.
They may add fusion candidates at the `RankedChunk[]` seam, but must not reimplement production encoding,
persistence, or scoring. A fixed equal-weight RRF is always reported separately from production routing.

The router configuration will contain:

- per-channel base weights
- score-separation and score-geometry influences
- term-coverage, pairwise-agreement, and dense-confidence influences
- identifier-likelihood and query-length influences
- channel-availability handling
- a versioned fusion method and optimization profile

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
profile selection is an explicit API/CLI choice; benchmark profiles remain evaluation objectives and
must be promoted through holdout evidence before replacing the compatibility default.

Production Sparse persistence and scoring use the fixed compatibility weight documented in ADR-0020. Fusion implementation,
evidence routing, and optimization profiles are tracked in issue #163.

## Rationale

**Why keep RRF as the default**: It is rank-based, robust to incomparable raw score scales, and preserves
current behavior while alternative fusion methods are validated.

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

- RRF remains a safe fallback while fusion alternatives are benchmarked and rolled out deliberately.
- Sparse participates in the same fusion seam with a fixed `1.0` weight until evidence routing lands.
- Fusion configurations become versioned and explainable rather than scattered constants.
- Every optimization result must distinguish fit-all quality from grouped and repository holdout quality.
- Weighted aggregate improvements require per-form and per-repository guardrails before production use.
