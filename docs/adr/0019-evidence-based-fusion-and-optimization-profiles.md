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
versus `73.3%`. Use the current Production router as the benchmark guardrail. Retain RRF only as an explicit
historical diagnostic and rollback baseline while the broader
matrix validation continues in issue #166.

Benchmarks compose production embedders and the production IndexStore with a benchmark-owned SQLite
database. Cold runs persist the physical benchmark index and channel rankings under
`benchmarks/.cache/retrieval/v1/`; warm runs reuse them. They may add fusion candidates at the
`RankedChunk[]` seam, but must not reimplement production encoding, persistence, or scoring. A fixed
equal-weight RRF is always reported separately from production routing.

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
documented token budget. Runtime query-form labels are not inferred from benchmark labels. The named
runtime profiles are part of the API; `compatibility` is currently the only matrix-calibrated profile,
while the remaining profiles temporarily reuse it until their matrix-derived weights and evidence
influences are selected.

Production Sparse persistence and scoring use the active configuration documented here and the storage
contract in ADR-0020. Fusion implementation, evidence routing, and optimization profiles are tracked in
issue #163.

## Rationale

**Why retain RRF as a baseline**: It is rank-based, robust to incomparable raw score scales, and provides
a stable diagnostic and rollback comparison while alternative fusion methods are validated.

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

## Runtime Estimation

The benchmark records `timings.evidenceRouterSearchDurationMs` separately from embedding, physical
retrieval, and static fusion. It is the wall-clock duration of the evidence-router stage, including
candidate preparation/evaluation, all router holdout jobs, fit-all jobs, and shared candidate-worker
queue overhead.

The number of router jobs is:

```text
J = M * F * (K + H + 1)
```

where `M` is the number of embedding models, `F` the number of router fusion methods, `K` the number
of grouped folds, and `H` the number of repository holdout jobs: one per selected repository when
repository holdouts are enabled and more than one repository is selected, otherwise `0`. The `+1` is
the fit-all recommendation job for each model/fusion pair. The current three objectives (`direct`,
`reranker-top20`, and
`reranker-top50`) are selected from one shared candidate search per job; they do not multiply the main
dynamic search by three. They add result selection and validation work only.

The current job counts are therefore:

| Profile and corpus selection        | `M` | `F` | `K` | `H` | Router jobs `J` |
| ----------------------------------- | --: | --: | --: | --: | --------------: |
| `develop`, one or more repositories |   1 |   1 |   3 |   0 |               4 |
| `validate`, all three repositories  |   1 |   1 |   5 |   3 |               9 |
| `full`, all three repositories      |   1 |   3 |   5 |   3 |              27 |

The implementation runs all planned jobs through one shared eleven-worker candidate queue. Therefore
`J` scales candidate work, but not necessarily wall-clock time linearly: jobs overlap and compete for the
same workers. The implementation also holds out all `K` folds and all selected repositories; the
factors are not `K - 1` and `H - 1`.

For the current `develop` calibration, each corpus has 15 authored questions and four query forms,
so the router sees 60 query samples. With one MiniLM model, DBSF only, grouped 3-fold, no repository
holdouts, the measured points are:

| Chunks `N` | Router time `T` |
| ---------: | --------------: |
|         91 |          8.98 s |
|        411 |        126.94 s |
|      6,386 |        954.05 s |

Each of the four jobs searches the same 40 router parameters with 64 global scouts, beam width 6,
and two coordinate passes. A job currently evaluates roughly 5.3k-5.9k proxy candidates and
3.2k-3.5k full candidates. The diagnostics are copied into one result row per objective, so these
counts must be deduplicated per job; they must not be summed across the three objective rows.

A provisional line for this exact workload is:

```text
T_develop(N) ~= 32.15 + 0.14 * N seconds
```

It is an empirical calibration from only three points (`R^2 ~= 0.9935`), not a universal complexity
law. For a first-order estimate of a different sample count `Q` and router-job count `J`, use the
variable work term as:

```text
T_rough(N, Q, J) ~= 32.15 + 0.14 * N * (Q / 60) * (J / 4) seconds
```

This intentionally excludes embedding time and should be treated as a planning estimate until runs
with controlled `K`, `H`, and `F` variations provide separate calibration for fixed overhead, worker
contention, and query-sample scaling. Full-run estimates must add embedding, physical retrieval, and
static fusion timings separately.

Using the current three corpora as one combined corpus (`N = 6,888` chunks and `Q = 180` query
samples), this provisional model predicts approximately 49 minutes for all-repository `develop`
with DBSF only (`J = 4`), 1 hour 49 minutes for all-repository `validate` with DBSF only (`J = 9`),
and 5 hours 26 minutes for the current all-repository `full` router stage (`J = 27`). These values
are deliberately estimates, not acceptance thresholds; a controlled multi-repository develop run is
still required to calibrate the query-sample and shared-worker effects.

The historical full artifact `retrieval-2026-08-01T10-12-09.945Z.json` completed in about 49 minutes
(43.8 minutes in the router stage), but it is schema 17 and uses
`halton-global-scout-elitist-beam-successive-halving-pareto`. Current schema 23 uses
`halton-global-scout-elitist-beam-proxy-promotion`. Its individual develop measurements are therefore
not directly comparable to that historical full run; the 5 hour 26 minute value is a projection for
the current strategy, not a claim about the older artifact.

A matched Schema-19 `fd` smoke comparison provides the current equivalence signal: the successive-
halving-pareto artifact reports `97.01 s` router time and the proxy-promotion artifact reports
`111.90 s`; their weighted evidence-router holdout summaries are identical at reported precision for
`direct`, `reranker-top20`, and `reranker-top50`. This is encouraging evidence for a faster successive-
halving mode, but it is not an automated A/B test and has not yet been repeated on FastAPI or Effect-TS.
The existing benchmark tests assert artifact structure and guardrails, not cross-strategy quality.

## Consequences

- DBSF is the active compatibility fusion; the current Production router is the benchmark guardrail, while
  RRF remains a safe fallback and explicit diagnostic baseline.
- Sparse participates in the same fusion seam with a promoted `0.1` dynamic base weight and observable
  evidence routing.
- Fusion configurations become typed, validated, and explainable rather than scattered constants.
- Every optimization result must distinguish fit-all quality from grouped and repository holdout quality.
- Weighted aggregate improvements require per-form and per-repository guardrails before production use.
