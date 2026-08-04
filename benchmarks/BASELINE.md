# Preliminary Retrieval Baseline

The schema-17 entries below are historical artifacts from the benchmark-owned Sparse implementation.
Current schema-21 runs use the production SparseEmbedder and IndexStore without benchmark vector caches.

## Schema 20: Search-Priority DBSF Selection

The current `search-priority` full-profile `fd` run is
`benchmarks/results/retrieval-2026-08-03T23-34-02.311Z.json`. Its authored query-form objective is
`identifier/agentTask/naturalQuestion/searchPhrase = 1/2/3/4`; the profile's channel weights are
authored seeds, not benchmark-derived deployment weights.

DBSF is the provisional production fusion choice from this evidence. Its fit-all result was
`R@5/R@10/R@20/Context@4k = 80.7%/96.7%/100.0%/81.3%`, compared with Relative Score at
`68.7%/96.7%/100.0%/73.3%`. Grouped holdouts also favored DBSF at R@5 and Context@4k
(`84.0%/81.3%` versus `69.3%/73.3%`), while R@10 and R@20 remained close. This is a single-repository
promotion signal, not a product-wide generalization claim; issue #166 owns the broader validation work.

The promoted Production configuration is the dynamic DBSF router, not the static fit-all weights:

| Parameter family | Identity | CamelCase |  BM25 | Dense | Sparse |
| ---------------- | -------: | --------: | ----: | ----: | -----: |
| Base weight      |     0.60 |      0.50 |  0.90 |  1.00 |   0.10 |
| Score            |     0.00 |      0.50 |  0.80 |  0.60 |   0.00 |
| Geometry         |     0.00 |      0.60 |  0.10 |  0.00 |   0.00 |
| Term coverage    |     0.00 |      0.10 |  0.20 |  0.00 |   0.00 |
| Pairwise         |     0.00 |      0.90 |  0.80 |  0.80 |   0.70 |
| Dense confidence |     0.00 |      0.00 |  0.00 |  0.60 |   0.00 |
| Identifier       |     0.00 |      0.40 | -0.10 | -0.10 |  -0.70 |
| Query length     |     0.00 |     -0.30 | -0.40 | -0.30 |  -0.40 |

The exact coupled runtime object is `PROMOTED_SEARCH_PRIORITY_CONFIG` in `src/domain/retrieval.ts`;
`PRODUCTION_COMPATIBILITY_CONFIG` is its direct alias. The other experimental Production profile names
currently reuse this same fusion/evidence model until the matrix determines distinct runtime values.
Benchmark-owned optimization profiles retain their authored base priors and are not separately promoted.

## Schema 17: Experimental Sparse Smoke

Schema 17 adds the benchmark-only Distill sparse ONNX channel while leaving production's four-channel
RRF router unchanged. The first smoke artifact is
`benchmarks/results/retrieval-2026-08-01T01-16-16.441Z.json`; the warm-cache rerun is
`benchmarks/results/retrieval-2026-08-01T01-23-05.432Z.json`.

The cold `fd` smoke run loaded the 67M document model in `16.19 s` and spent `7.44 s` encoding/cache
writing. The warm rerun reported `cacheHit=yes`, `0.56 s` model load, and `0.00 s` chunk/cache work.
Sparse-only `R@20` was `66.7%` for agent tasks, `80.0%` for identifiers, `60.0%` for natural questions,
and `66.7%` for search phrases. Sparse-inclusive RRF matched the existing four-channel RRF at aggregate
`R@20` on this smoke corpus; this is an implementation check, not holdout evidence for production.

The warm full-corpus validate artifact is
`benchmarks/results/retrieval-2026-08-01T01-58-14.247Z.json`. All three sparse caches hit. The static
DBSF candidate with sparse included reached grouped `R@5/R@10/R@20/Context@4k = 60.6%/71.7%/79.4%/63.6%`
and LORO `61.4%/73.1%/81.7%/67.5%`; the fit-all candidate selected `0.40/0.00/1.00/0.70/0.00`
in Identity/CamelCase/BM25/Dense/Sparse order. The production four-channel RRF holdouts remained the
Schema-16 values exactly (`55.0%/63.6%/70.3%/84.7%/58.6%` for both grouped and LORO). Sparse is
therefore wired and measurable, but the current validate run does not justify production promotion.

The matched MiniLM three-fusion artifact is `benchmarks/results/retrieval-2026-08-01T10-12-09.945Z.json`.
Static holdouts were:

| Fusion         | Grouped R@5 | Grouped R@10 | Grouped R@20 | Grouped Context@4k | LORO R@5 | LORO R@10 | LORO R@20 | LORO Context@4k |
| -------------- | ----------: | -----------: | -----------: | -----------------: | -------: | --------: | --------: | --------------: |
| RRF            |       62.8% |        72.2% |        75.8% |              66.1% |    60.8% |     70.8% |     78.6% |           65.8% |
| Relative score |       58.3% |        69.7% |        83.1% |              64.4% |    60.8% |     71.1% |     83.3% |           66.1% |
| DBSF           |       60.6% |        71.7% |        79.4% |              63.6% |    61.4% |     73.1% |     81.7% |           67.5% |

Relative score is the strongest MiniLM static R@20 candidate. Its selected dynamic LORO candidates
miss the production guardrail, so the fit-all values below are descriptive rather than deployment
evidence. The fit-all sparse weights are fusion-specific: `0.10` for RRF, `0.25` for Relative Score,
and `0.00` for DBSF.

### Matched BGE Full Run

The same schema-17 full profile was run with `Xenova/bge-small-en-v1.5` in
`benchmarks/results/retrieval-2026-08-01T09-22-46.752Z.json`. Both model runs use the same three pinned
repositories, `180` query representations, grouped 5-fold and leave-one-repository-out holdouts, all
three fusion methods, and both static and evidence-router fit-all candidates.

Sparse integration checks passed for both artifacts: all three repository caches hit, each artifact has
`180` sparse and `180` `rrf+sparse` measurements, and all `180` `rrf` versus `rrf-no-sparse` control
pairs are identical. The raw full-corpus rows are not holdouts, but they show the marginal effect before
fusion tuning:

| Model     | Dense-only R@20 | Sparse-only R@20 | RRF R@20 | RRF+sparse R@20 | Sparse delta | RRF Ctx@4k | RRF+sparse Ctx@4k |
| --------- | --------------: | ---------------: | -------: | --------------: | -----------: | ---------: | ----------------: |
| MiniLM    |           74.4% |            45.6% |    70.3% |           76.4% |       +6.1pp |      59.7% |             62.8% |
| BGE-small |           81.9% |            45.6% |    73.1% |           75.0% |       +1.9pp |      58.6% |             60.6% |

The holdout and static fit-all picture is:

| Model     | Fusion         | Grouped R@20 | LORO R@20 | Fit-all weights I/C/B/D/S | Fit-all R@20 | Fit-all Ctx@4k |
| --------- | -------------- | -----------: | --------: | ------------------------- | -----------: | -------------: |
| MiniLM    | RRF            |        75.8% |     78.6% | 0.25/0.10/1.00/0.70/0.10  |        82.2% |          69.2% |
| MiniLM    | Relative score |        83.1% |     83.3% | 0.30/0.30/1.00/0.50/0.25  |        84.7% |          66.9% |
| MiniLM    | DBSF           |        79.4% |     81.7% | 0.40/0.00/1.00/0.70/0.00  |        83.9% |          64.7% |
| BGE-small | RRF            |        86.4% |     81.1% | 0.10/0.20/0.67/1.00/0.00  |        87.8% |          68.6% |
| BGE-small | Relative score |        86.7% |     88.3% | 0.20/0.25/0.80/1.00/0.00  |        89.4% |          69.4% |
| BGE-small | DBSF           |        87.8% |     88.3% | 0.20/0.20/0.50/1.00/0.00  |        89.4% |          68.9% |

The direct-objective evidence-router fit-all candidates also retain a positive sparse base weight:
MiniLM uses `0.10/0.25/0.20` for RRF/Relative Score/DBSF and BGE uses `0.10/0.10/0.10`.
The static `0.00` in the BGE fit-all rows is therefore not a missing channel. Static candidates are
explicitly allowed to use `0` (`WEIGHT_LEVELS = [0, 0.5, 1, 2]`); BGE's stronger dense channel made
Sparse redundant for that particular all-sample static objective. MiniLM still assigns Sparse positive
fit-all weight for RRF and Relative Score, and raw equal-weight RRF improves by `6.1` R@20 points.
Sparse is consequently a useful complementary benchmark channel, but its weight must remain model- and
fusion-specific rather than being forced globally.

## Schema 16: Production RRF Guardrails And Objective-Specific Router Search

Schema 16 adds an explicit holdout evaluation of the current production RRF query-length router,
Recall@50, and three deployment objectives: `direct`, `reranker-top20`, and `reranker-top50`. One
shared Pareto search produces candidates for all three objectives. Candidate selection uses a 1%
development guardrail against the production RRF baseline; holdout rows below decide generalization.
The artifact is `benchmarks/results/retrieval-2026-07-31T23-54-20.351Z.json`.

### Production RRF Holdouts

| Model  | Validation strategy |   R@5 |  R@10 |  R@20 |  R@50 | Context@4k |
| ------ | ------------------- | ----: | ----: | ----: | ----: | ---------: |
| MiniLM | Grouped 5-fold      | 55.0% | 63.6% | 70.3% | 84.7% |      58.6% |
| MiniLM | LORO                | 55.0% | 63.6% | 70.3% | 84.7% |      58.6% |

### Objective Holdouts

Validation metrics are excluded-fold results. Production columns are repeated here as the guardrail
reference for each objective.

| Objective      | Validation strategy | Production R@5 | Dynamic R@5 | Production R@10 | Dynamic R@10 | Production R@20 | Dynamic R@20 | Production R@50 | Dynamic R@50 | Production Context@4k | Dynamic Context@4k |
| -------------- | ------------------- | -------------: | ----------: | --------------: | -----------: | --------------: | -----------: | --------------: | -----------: | --------------------: | -----------------: |
| direct         | Grouped 5-fold      |          55.0% |       61.7% |           63.6% |        71.9% |           70.3% |        80.0% |           84.7% |        86.4% |                 58.6% |              67.5% |
| reranker-top20 | Grouped 5-fold      |          55.0% |       63.3% |           63.6% |        74.2% |           70.3% |        78.1% |           84.7% |        88.9% |                 58.6% |              66.1% |
| reranker-top50 | Grouped 5-fold      |          55.0% |       59.4% |           63.6% |        72.5% |           70.3% |        80.3% |           84.7% |        89.2% |                 58.6% |              63.9% |
| direct         | LORO                |          55.0% |       61.1% |           63.6% |        73.6% |           70.3% |        81.9% |           84.7% |        88.9% |                 58.6% |              66.4% |
| reranker-top20 | LORO                |          55.0% |       60.0% |           63.6% |        72.5% |           70.3% |        81.1% |           84.7% |        89.4% |                 58.6% |              65.3% |
| reranker-top50 | LORO                |          55.0% |       59.2% |           63.6% |        71.4% |           70.3% |        80.6% |           84.7% |        88.3% |                 58.6% |              62.5% |

The direct objective is strongest at R@5, while `reranker-top50` is strongest at R@50. The
reranker-top20 candidate is competitive at R@20 and preserves a larger context-recall margin than
the top-50 candidate. These results support separate scenario candidates, not one universal router;
they do not yet justify changing production routing or adding a reranker.

### Fit-All Candidates

The final candidates are descriptive fits over all 180 samples. The dynamic base weights are shown;
the artifact retains all learned feature influences.

| Objective      | Base weights I/C/B/D | Fit R@5 | Fit R@10 | Fit R@20 | Fit R@50 | Fit Context@4k |
| -------------- | -------------------- | ------: | -------: | -------: | -------: | -------------: |
| direct         | 1.00/0.11/0.30/0.60  |   66.7% |    75.3% |    81.4% |    86.7% |          71.9% |
| reranker-top20 | 0.40/0.80/1.00/1.00  |   60.0% |    73.1% |    84.2% |    91.4% |          64.4% |
| reranker-top50 | 0.60/0.80/1.00/1.00  |   59.7% |    72.5% |    83.1% |    92.5% |          61.7% |

### Compute Timing

Compute timing excludes JSON and Markdown artifact serialization. The run took `471.30 s` total:
router search `419.99 s`, fusion search `32.52 s`, corpus preparation `9.60 s`, embedding `2.06 s`,
and SQLite retrieval `2.58 s`. The fit-all search evaluated `3,973` proxy candidates and `2,580`
full candidates per shared search. The additional objectives increase search cost; future reductions
must preserve the shared-search and holdout semantics.

## Schema 15: Successive Halving Router Search

Schema 15 adds deterministic successive halving to the evidence-router optimizer. Each candidate pool is
first evaluated on a 25% proxy sample, stratified by repository and query form with a 32-sample minimum;
the best eight beam widths and protected exact elites receive full development evaluation. The artifact
is `benchmarks/results/retrieval-2026-07-31T17-38-02.556Z.json`.

The validate run uses the same MiniLM model, pinned repositories, folds, and static DBSF controls as
Schema 14. Hold-out quality remains within rounding-level movement while compute time improves from
`390.61 s` to `361.76 s` (`-7.4%`); router search improves from `343.33 s` to `311.26 s` (`-9.3%`).

### Dynamic Hold-outs

| Model  | Fusion | Validation strategy |   R@5 |  R@10 |  R@20 | Context@4k |
| ------ | ------ | ------------------- | ----: | ----: | ----: | ---------: |
| MiniLM | DBSF   | Grouped 5-fold      | 62.2% | 73.6% | 78.1% |      65.6% |
| MiniLM | DBSF   | LORO                | 63.3% | 73.1% | 80.0% |      69.2% |

### Static Controls

| Model  | Fusion | Validation strategy |   R@5 |  R@10 |  R@20 | Context@4k |
| ------ | ------ | ------------------- | ----: | ----: | ----: | ---------: |
| MiniLM | DBSF   | Grouped 5-fold      | 61.7% | 72.5% | 79.4% |      63.1% |
| MiniLM | DBSF   | LORO                | 59.2% | 73.1% | 81.1% |      64.2% |

### Fit-All Preview

| Model  | Fusion |   R@5 |  R@10 |  R@20 | Context@4k |
| ------ | ------ | ----: | ----: | ----: | ---------: |
| MiniLM | DBSF   | 59.4% | 74.2% | 83.9% |      65.3% |

### Compute Timing

Compute timing excludes JSON and Markdown artifact serialization. The run took `361.76 s` total:
router search `311.26 s`, fusion search `32.30 s`, corpus preparation `9.20 s`, embedding `2.02 s`,
and SQLite retrieval `2.50 s`. The fit-all router evaluated `3,693` proxy candidates and `2,384` full
candidates. The small hold-out movements are recorded rather than treated as a universal quality gain;
future optimizer changes must compare the same pinned corpora, model, folds, and static controls.

## Schema 14: Router Search Strategy And Runtime Telemetry

Schema 14 records the deterministic `halton-global-scout-elitist-beam` router search strategy and
compute-time breakdown in every artifact. The strategy uses 64 global Halton scout points, a six-
candidate elitist beam, two alternating coordinate passes, and a 200-candidate fusion depth. Fusion
normalization is cached per ranking and method so candidate weights do not repeat invariant work. The
artifact is `benchmarks/results/retrieval-2026-07-31T16-03-14.892Z.json`.

The validate run uses MiniLM on all three pinned repositories. Dynamic quality is compared with a
static DBSF baseline selected on the same development samples; all reported validation rows are
excluded-fold results.

### Dynamic Hold-outs

| Model  | Fusion | Validation strategy |   R@5 |  R@10 |  R@20 | Context@4k |
| ------ | ------ | ------------------- | ----: | ----: | ----: | ---------: |
| MiniLM | DBSF   | Grouped 5-fold      | 62.2% | 73.6% | 78.1% |      65.6% |
| MiniLM | DBSF   | LORO                | 63.3% | 73.1% | 80.0% |      69.2% |

### Static Controls

| Model  | Fusion | Validation strategy |   R@5 |  R@10 |  R@20 | Context@4k |
| ------ | ------ | ------------------- | ----: | ----: | ----: | ---------: |
| MiniLM | DBSF   | Grouped 5-fold      | 61.7% | 72.5% | 79.4% |      63.1% |
| MiniLM | DBSF   | LORO                | 59.2% | 73.1% | 81.1% |      64.2% |

### Fit-All Preview

| Model  | Fusion |   R@5 |  R@10 |  R@20 | Context@4k |
| ------ | ------ | ----: | ----: | ----: | ---------: |
| MiniLM | DBSF   | 60.0% | 74.2% | 83.9% |      64.7% |

### Compute Timing

Compute timing excludes JSON and Markdown artifact serialization. The router optimizer dominates the
run cost: `343.33 s` of `390.61 s` total compute time. Fusion search takes `30.25 s`; corpus
preparation takes `8.61 s`; embedding takes `1.77 s`; SQLite retrieval takes `2.33 s`.

On the identical `smoke` profile, cached fusion normalization reduced compute time from `53.28 s` to
`41.07 s` and router search from `44.39 s` to `35.38 s`; the quality tables remained unchanged.

The new search strategy improves exploration, but this run is the new Schema-14 reference rather than
a claim of universal quality improvement. Future optimizer changes must compare the same pinned
corpora, model, folds, and static controls before promotion.

## Schema 13: Recall@5 And Stratified Grouped Folds

Schema 13 adds aggregate `Recall@5` to quality summaries and reports. Grouped folds now use a fixed-seed
deterministic shuffle of intent groups per repository followed by category/difficulty-stratified assignment;
leave-one-repository-out remains the separate repository-generalization holdout. The BGE full run below uses
the new grouped split and all three active fusion methods. The artifact is
`benchmarks/results/retrieval-2026-07-31T13-29-31.177Z.json`.

### Dynamic Hold-outs

| Model     | Fusion         | Validation strategy |   R@5 |  R@10 |  R@20 | Context@4k |
| --------- | -------------- | ------------------- | ----: | ----: | ----: | ---------: |
| BGE-small | RRF            | Grouped 5-fold      | 65.3% | 76.4% | 86.9% |      70.0% |
| BGE-small | RRF            | LORO                | 62.2% | 75.3% | 84.4% |      70.0% |
| BGE-small | Relative score | Grouped 5-fold      | 62.8% | 76.1% | 88.9% |      67.8% |
| BGE-small | Relative score | LORO                | 62.8% | 75.3% | 87.2% |      67.2% |
| BGE-small | DBSF           | Grouped 5-fold      | 62.2% | 75.3% | 86.7% |      65.3% |
| BGE-small | DBSF           | LORO                | 63.9% | 75.8% | 88.3% |      68.3% |

### Fit-All Preview

| Model     | Fusion         |   R@5 |  R@10 |  R@20 | Context@4k |
| --------- | -------------- | ----: | ----: | ----: | ---------: |
| BGE-small | RRF            | 65.0% | 75.8% | 88.3% |      69.7% |
| BGE-small | Relative score | 64.2% | 77.8% | 89.4% |      71.1% |
| BGE-small | DBSF           | 64.2% | 77.5% | 90.0% |      69.4% |

LORO is unchanged from Schema 12, as expected: only the grouped intent assignment changed. Relative
Score remains the strongest grouped dynamic candidate at R@20 (88.9%), while RRF has the strongest
grouped dynamic `R@5` and context recall. DBSF loses grouped holdout quality relative to the previous
split, so the grouped result is split-sensitive; the LORO result remains the stronger cross-repository
generalization signal.

## Schema 12: Dense Confidence And BGE Comparison

Schema 12 adds dense confidence from the dense score distribution: top score relative to the median,
MAD-based robust deviation, and score-tail strength. The full milestone now evaluates MiniLM and BGE
separately with all three fusion methods. Each model still runs in its own process so model selection,
cache identity, and timing remain unambiguous.

### Dynamic Hold-outs

| Model     | Fusion         | Validation strategy |  R@10 |  R@20 | Context@4k |
| --------- | -------------- | ------------------- | ----: | ----: | ---------: |
| MiniLM    | RRF            | Grouped 5-fold      | 66.9% | 76.4% |      63.3% |
| MiniLM    | RRF            | LORO                | 72.5% | 80.3% |      67.5% |
| MiniLM    | Relative score | Grouped 5-fold      | 73.3% | 82.8% |      65.0% |
| MiniLM    | Relative score | LORO                | 68.1% | 83.6% |      60.6% |
| MiniLM    | DBSF           | Grouped 5-fold      | 72.5% | 80.8% |      66.1% |
| MiniLM    | DBSF           | LORO                | 73.1% | 80.3% |      68.6% |
| BGE-small | RRF            | Grouped 5-fold      | 74.7% | 85.0% |      67.5% |
| BGE-small | RRF            | LORO                | 75.3% | 84.4% |      70.0% |
| BGE-small | Relative score | Grouped 5-fold      | 76.7% | 87.8% |      68.9% |
| BGE-small | Relative score | LORO                | 75.3% | 87.2% |      67.2% |
| BGE-small | DBSF           | Grouped 5-fold      | 76.4% | 88.9% |      68.1% |
| BGE-small | DBSF           | LORO                | 75.8% | 88.3% |      68.3% |

### Fit-All Preview

| Model     | Fusion         |  R@10 |  R@20 | Context@4k |
| --------- | -------------- | ----: | ----: | ---------: |
| MiniLM    | RRF            | 69.2% | 83.6% |      65.6% |
| MiniLM    | Relative score | 72.5% | 85.8% |      63.3% |
| MiniLM    | DBSF           | 74.2% | 83.9% |      66.4% |
| BGE-small | RRF            | 75.8% | 88.3% |      69.7% |
| BGE-small | Relative score | 77.8% | 89.4% |      71.1% |
| BGE-small | DBSF           | 77.5% | 90.0% |      69.4% |

BGE improves dense and fused hold-out recall substantially over MiniLM. For MiniLM, Relative Score
remains the strongest dynamic recall candidate. For BGE, DBSF leads dynamic R@20 in both grouped and
LORO validation. Dense confidence changes the ranking and context trade-offs but is not a universal
improvement; the model and fusion method must remain paired in regression comparisons.

## Schema 11: Pairwise Agreement

Schema 11 replaces aggregate cross-channel agreement with symmetric agreement across all six channel
pairs at K=5, 10, and 20. The active comparison contains Relative Score and DBSF only; RRF remains a
historical reference and is not run in the active matrix.

| Fusion         | Validation strategy | Static R@10 | Dynamic R@10 | Static R@20 | Dynamic R@20 | Static context@4k | Dynamic context@4k |
| -------------- | ------------------- | ----------: | -----------: | ----------: | -----------: | ----------------: | -----------------: |
| Relative score | Grouped 5-fold      |       70.8% |        72.2% |       82.8% |        83.3% |             61.9% |              65.6% |
| Relative score | LORO                |       70.8% |        68.3% |       83.3% |        82.8% |             64.7% |              61.1% |
| DBSF           | Grouped 5-fold      |       71.9% |        72.5% |       78.9% |        80.8% |             65.0% |              65.6% |
| DBSF           | LORO                |       72.5% |        72.5% |       81.1% |        79.7% |             64.7% |              68.6% |

### Fit-All Preview

| Fusion         | Static R@10 | Dynamic R@10 | Static R@20 | Dynamic R@20 | Static context@4k | Dynamic context@4k |
| -------------- | ----------: | -----------: | ----------: | -----------: | ----------------: | -----------------: |
| Relative score |       73.9% |        72.8% |       84.7% |        85.3% |             63.6% |              64.7% |
| DBSF           |       74.2% |        73.6% |       83.9% |        83.9% |             64.7% |              65.8% |

Pairwise agreement is not a robust improvement over Schema 10. Relative Score gains 1.1 grouped
R@20 points but loses 0.9 LORO R@10 and 0.5 LORO R@20. DBSF has unchanged dynamic recall and only
small context movement. Relative Score remains the recall-first candidate, but pairwise agreement
does not justify a production change by itself.

## Schema 10: Query-Term Coverage Across Fusion Methods

Schema 10 adds three lexical coverage signals to the Schema-9 router: BM25 query coverage weighted
by term IDF, exact full-identifier coverage, and CamelCase constituent coverage. The signals are
mapped to their corresponding channels; dense receives a neutral value. Static and dynamic rows use
the same fusion method.

| Fusion         | Validation strategy | Static R@10 | Dynamic R@10 | Static R@20 | Dynamic R@20 | Static context@4k | Dynamic context@4k |
| -------------- | ------------------- | ----------: | -----------: | ----------: | -----------: | ----------------: | -----------------: |
| Weighted RRF   | Grouped 5-fold      |       69.2% |        68.1% |       76.9% |        76.4% |             64.4% |              64.4% |
| Weighted RRF   | LORO                |       70.8% |        71.4% |       78.6% |        80.3% |             66.9% |              67.5% |
| Relative score | Grouped 5-fold      |       70.8% |        72.8% |       82.8% |        82.2% |             61.9% |              66.7% |
| Relative score | LORO                |       70.8% |        69.2% |       83.3% |        83.3% |             64.7% |              61.4% |
| DBSF           | Grouped 5-fold      |       71.9% |        72.5% |       78.9% |        80.8% |             65.0% |              66.1% |
| DBSF           | LORO                |       72.5% |        72.5% |       81.1% |        79.7% |             64.7% |              68.6% |

### Fit-All Preview

These candidates use all 180 query representations and are descriptive in-sample measurements, not
generalization evidence.

| Fusion         | Static R@10 | Dynamic R@10 | Static R@20 | Dynamic R@20 | Static context@4k | Dynamic context@4k |
| -------------- | ----------: | -----------: | ----------: | -----------: | ----------------: | -----------------: |
| Weighted RRF   |       68.1% |        67.5% |       83.1% |        83.6% |             62.8% |              63.3% |
| Relative score |       73.9% |        74.7% |       84.7% |        85.3% |             63.6% |              64.2% |
| DBSF           |       74.2% |        75.3% |       83.9% |        83.9% |             64.7% |              64.2% |

Among dynamic holdouts, relative-score remains best for R@20 in both grouped and LORO validation.
DBSF has the strongest LORO R@10 and context recall; relative-score has the strongest grouped R@10
and context recall. Term coverage therefore adds useful context quality in several splits but does
not displace relative-score as the recall-first candidate.

## Schema 9: Score Geometry Across Fusion Methods

Schema 9 adds one composite score-geometry confidence signal to the stable schema-5 linear router.
It combines normalized top-score gaps, score-curve area, plateau width, entropy, and effective
candidate count. The router is evaluated independently with RRF, relative-score fusion, and DBSF;
each static baseline uses the same fusion method as its dynamic counterpart.

| Fusion         | Validation strategy | Static R@10 | Dynamic R@10 | Static R@20 | Dynamic R@20 | Static context@4k | Dynamic context@4k |
| -------------- | ------------------- | ----------: | -----------: | ----------: | -----------: | ----------------: | -----------------: |
| Weighted RRF   | Grouped 5-fold      |       69.2% |        66.9% |       76.9% |        75.8% |             64.4% |              62.8% |
| Weighted RRF   | LORO                |       70.8% |        71.4% |       78.6% |        80.3% |             66.9% |              68.1% |
| Relative score | Grouped 5-fold      |       70.8% |        72.8% |       82.8% |        82.2% |             61.9% |              66.1% |
| Relative score | LORO                |       70.8% |        70.8% |       83.3% |        82.8% |             64.7% |              64.2% |
| DBSF           | Grouped 5-fold      |       71.9% |        72.5% |       78.9% |        80.8% |             65.0% |              65.0% |
| DBSF           | LORO                |       72.5% |        73.1% |       81.1% |        80.8% |             64.7% |              65.8% |

### Fit-All Preview

These candidates are fitted and measured on all 180 query representations. They are useful for
comparing the eventual deployment candidates, but they are in-sample and do not replace hold-out
quality.

| Fusion         | Static R@10 | Dynamic R@10 | Static R@20 | Dynamic R@20 | Static context@4k | Dynamic context@4k |
| -------------- | ----------: | -----------: | ----------: | -----------: | ----------------: | -----------------: |
| Weighted RRF   |       68.1% |        67.5% |       83.1% |        83.6% |             62.8% |              63.3% |
| Relative score |       73.9% |        74.4% |       84.7% |        85.3% |             63.6% |              64.2% |
| DBSF           |       74.2% |        73.6% |       83.9% |        83.9% |             64.7% |              66.4% |

Relative-score is also the strongest fit-all dynamic candidate for R@10 and R@20. DBSF has the
strongest fit-all dynamic context recall. The hold-out rows above remain the decision criterion.

The static columns are controls for measuring the incremental value of score geometry; the dynamic
columns determine which fusion path is strongest. Among dynamic routers, relative-score leads grouped
R@10, grouped R@20, grouped context recall, and LORO R@20. DBSF leads LORO R@10, while RRF leads only
LORO context recall. With recall as the primary objective, relative-score is therefore the current
best dynamic candidate. This does not prove that score geometry itself is universally useful: relative
score's improvement over its static baseline is mixed, so more intents and repositories are needed
before production promotion.

## Schema 8: Dynamic DBSF Weights

Schema 8 changes only the fusion operation used by the stable schema-5 evidence router. Static and
dynamic weights are now both selected and evaluated with DBSF. Query length, identifier shape, score
separation, channel availability, aggregate cross-channel agreement, the linear multiplicative
kernel, and the positive dynamic base floor remain unchanged.

| Validation strategy | Static R@10 | Dynamic R@10 | Static R@20 | Dynamic R@20 | Static context@4k | Dynamic context@4k |
| ------------------- | ----------: | -----------: | ----------: | -----------: | ----------------: | -----------------: |
| Grouped 3-fold      |       73.1% |        73.1% |       80.0% |        80.3% |             64.4% |              63.9% |
| Grouped 5-fold      |       71.9% |        72.5% |       78.9% |        80.8% |             65.0% |              65.0% |
| Leave-one-repo-out  |       72.5% |        73.1% |       81.1% |        80.3% |             64.7% |              64.2% |
| Fit all 180 queries |       74.2% |        73.6% |       83.9% |        83.9% |             64.7% |              64.7% |

Dynamic DBSF improves grouped 5-fold R@10 by 0.6 points and R@20 by 1.9 points without changing 4k
context recall. Repository generalization is mixed: R@10 improves by 0.6 points, while R@20 loses 0.8
and context recall loses 0.5 points. Fold-selected coefficients remain variable, and the fit-all
candidate does not improve static quality. Schema 8 therefore validates DBSF as a viable dynamic
fusion path but does not justify production promotion. Schema 9 should test score-geometry confidence
signals against this DBSF baseline.

## Schema 7: Static Fusion Methods

Schema 7 restores the stable schema-5 evidence kernel and compares three fusion algorithms using the
same physical rankings. Each method tunes its own positive static channel weights on development
samples before unchanged grouped and repository holdout evaluation. Relative-score fusion applies
per-channel min-max normalization; DBSF normalizes from each top-200 list's mean and sample standard
deviation. Constant or single-result lists contribute a neutral 0.5 in both score-based methods.

| Fusion         | Grouped R@10 | Grouped R@20 | Grouped context@4k | LORO R@10 | LORO R@20 | LORO context@4k |
| -------------- | -----------: | -----------: | -----------------: | --------: | --------: | --------------: |
| Weighted RRF   |        69.2% |        76.9% |              64.4% |     70.8% |     78.6% |           66.9% |
| Relative score |        70.8% |        82.8% |              61.9% |     70.8% |     83.3% |           64.7% |
| DBSF           |        71.9% |        78.9% |              65.0% |     72.5% |     81.1% |           64.7% |

Relative-score fusion provides the largest candidate-recall gain over RRF: +5.9 grouped and +4.7
LORO R@20, at the cost of roughly two context-recall points. DBSF is the more balanced improvement:
it gains 2.7/1.7 R@10 and 2.0/2.5 R@20, improves grouped context by 0.6, and loses 2.2 LORO context
points. Score magnitude therefore contains substantial useful information that rank-only RRF drops.
Schema 8 should evaluate evidence-based dynamic weights with the strongest score fusion methods rather
than adding new observable signals immediately.

## Schema 6: Symmetric Log2 Evidence Kernel

Schema 6 kept schema 5's positive dynamic bases and replaced the asymmetric linear factors with
signed, per-channel Log2 coefficients. Score separation, agreement, identifier shape, and query
length were centered to [-1, 1]. Their contributions added in Log2 space and were clamped to [-2, 2],
allowing a final evidence multiplier from 0.25 to 4.0. No new observable signal was added.

| Validation strategy | Static R@10 | Dynamic R@10 | Static R@20 | Dynamic R@20 | Static context@4k | Dynamic context@4k |
| ------------------- | ----------: | -----------: | ----------: | -----------: | ----------------: | -----------------: |
| Grouped 5-fold      |       69.2% |        68.6% |       76.9% |        76.4% |             64.4% |              64.4% |
| Leave-one-repo-out  |       70.8% |        69.7% |       78.6% |        81.1% |             66.9% |              65.3% |
| Fit all 180 queries |       68.1% |        69.2% |       83.1% |        83.1% |             62.8% |              62.8% |

The fit-all bases were `1.00/0.50/1.00/0.70`. Score coefficients were
`0.30/-0.10/0.00/-0.10`, agreement coefficients `1.00/0.00/0.00/0.00`, and every identifier and
length coefficient was zero. Fold-selected coefficients varied substantially and often reversed
signs. Compared with schema 5, the Log2 kernel gained 0.8 points of LORO R@20 but lost 1.7 grouped
points; both strategies lost R@10 relative to static baselines. Schema 7 therefore returned to the
schema-5 kernel while preserving schema 6 as a negative experiment.

## Schema 5: Positive Dynamic Bases

Schema 5 changes only the dynamic-router base-weight search: every physical channel receives at least
0.1, while static baselines and evidence coefficients may still use zero. The linear multiplicative
kernel and all observable signals remain identical to schema 4. The search also caches repeated
quality evaluations; this changes runtime, not candidate selection.

| Validation strategy | Static R@10 | Dynamic R@10 | Static R@20 | Dynamic R@20 | Static context@4k | Dynamic context@4k |
| ------------------- | ----------: | -----------: | ----------: | -----------: | ----------------: | -----------------: |
| Grouped 5-fold      |       69.2% |        68.1% |       76.9% |        78.1% |             64.4% |              63.3% |
| Leave-one-repo-out  |       70.8% |        70.3% |       78.6% |        80.3% |             66.9% |              64.7% |
| Fit all 180 queries |       68.1% |        68.6% |       83.1% |        83.1% |             62.8% |              63.3% |

The fit-all router remains exactly the schema-4 candidate because its bases were already all positive:
`0.40/0.50/1.00/0.70`. Holdout R@20 is effectively unchanged, while LORO context recall drops by
roughly 0.6 points. Forcing a positive base therefore neither solves nor materially worsens routing,
but it confirms that zero-base channel deletion was not driving schema 4's behavior. Schema 6 can now
isolate the symmetric Log2 kernel without dead channels confounding the result.

## Schema 4: Fine-Grained Channel Interactions

Schema 4 replaces shared evidence strengths with per-channel coefficients, adds centered signed
query-length and identifier-shape interactions, and refines parameters in 0.1 steps through a bounded
six-candidate beam with two coordinate passes. It uses the same 180 MiniLM queries and the same
grouped holdouts as schema 3.

| Validation strategy | Static R@10 | Dynamic R@10 | Static R@20 | Dynamic R@20 | Static context@4k | Dynamic context@4k |
| ------------------- | ----------: | -----------: | ----------: | -----------: | ----------------: | -----------------: |
| Grouped 5-fold      |       69.1% |        68.0% |       76.9% |        78.0% |             64.5% |              63.4% |
| Leave-one-repo-out  |       70.8% |        70.3% |       78.6% |        80.3% |             67.0% |              65.3% |
| Fit all 180 queries |       68.1% |        68.6% |       83.1% |        83.1% |             62.8% |              63.3% |

The fit-all dynamic candidate has base weights `0.40/0.50/1.00/0.70`. Its score coefficients are
`0.20/0.10/0.00/0.00`, agreement coefficients `0.20/0.00/0.00/0.00`, identifier slopes
`0.00/0.00/0.00/-0.10`, and length slopes `0.10/0.00/0.00/0.00`, always in Identity, CamelCase,
BM25, Dense order. These small and partly counterintuitive interactions are not stable across folds.
The finer search improves dynamic holdout R@20 but slightly regresses R@10 and context recall while
also finding a stronger static baseline. This is evidence that the added flexibility is real and that
the holdouts detect its overfitting; it is not yet a production configuration.

### MiniLM versus BGE-small

The same schema-4 run with `Xenova/bge-small-en-v1.5` shows that dense-model quality still matters.
Dense-only R@20 is the unvalidated full-corpus average; router columns are excluded-fold results.

| Model     | Dense-only R@20 | Grouped static R@20 | Grouped dynamic R@20 | LORO static R@20 | LORO dynamic R@20 | Grouped dynamic context@4k | LORO dynamic context@4k |
| --------- | --------------: | ------------------: | -------------------: | ---------------: | ----------------: | -------------------------: | ----------------------: |
| MiniLM    |           74.4% |               76.9% |                78.0% |            78.6% |             80.3% |                      63.4% |                   65.3% |
| BGE-small |           81.9% |               85.0% |                85.6% |            82.2% |             82.8% |                      67.5% |                   67.8% |

BGE-small's stronger dense channel improves every aggregate R@20 and context result. Dynamic evidence
adds 0.6 points of R@20 over BGE's stronger static baseline in both validation strategies, compared
with MiniLM's 1.1 grouped and 1.7 LORO gains. Fusion therefore does not erase the dense-model gap, but
it reduces the repository-generalization gap from 7.6 grouped points to 2.5 LORO points. Model choice
and routing configuration must remain paired: BGE's fit-all router gives Dense a base weight of 1.0,
whereas MiniLM's gives it 0.7. Historical local measurements found BGE roughly twice as slow to embed
the Effect corpus, so its quality gain must still be evaluated against indexing cost.

## Schema 3: Evidence Router MiniLM

Measured across all 180 query representations without exposing authored query-form labels to the
router. Each development split selected one shared router from query length, identifier-like shape,
within-channel score separation, channel availability, and cross-channel rank agreement. The static
comparison selected one fixed weight vector on the same development samples.

| Validation strategy | Static R@10 | Dynamic R@10 | Static R@20 | Dynamic R@20 | Static context@4k | Dynamic context@4k |
| ------------------- | ----------: | -----------: | ----------: | -----------: | ----------------: | -----------------: |
| Grouped 5-fold      |       71.4% |        70.8% |       75.8% |        77.5% |             67.2% |              66.1% |
| Leave-one-repo-out  |       69.2% |        70.8% |       78.1% |        78.6% |             61.4% |              67.5% |
| Fit all 180 queries |       72.5% |        73.1% |       81.1% |        82.5% |             62.5% |              64.4% |

The fit-all candidate uses base weights `0.25/0.25/1.00/0.50` for Identity, CamelCase, BM25, and
Dense, full score-separation influence, no agreement or identifier-shape influence, and half query-
length influence. It is not a production recommendation yet. Fold-selected configurations vary,
grouped R@10 and 4k context recall regress slightly, and the fd repository holdout loses 1.7 points
of R@20 even while gaining 15 points of context recall. The result validates the evidence-routing
mechanism and identifies score separation as promising, but not yet stable enough to replace the
production heuristic.

## Schema 2: Cross-Validated MiniLM

Measured across all 45 intents and all three repositories with four grouped query representations.
The close agreement between grouped 5-fold and leave-one-repository-out is encouraging, but these
weights are still benchmark evidence rather than production routing rules.

| Query form       | Grouped 5-fold R@20 | Leave-one-repo-out R@20 | Fit-all weights I/C/B/D |
| ---------------- | ------------------: | ----------------------: | ----------------------- |
| Identifier       |               85.6% |                   85.5% | `1.00/0.00/0.00/1.00`   |
| Search phrase    |               81.1% |                   83.3% | `0.00/0.25/1.00/0.25`   |
| Natural question |               73.4% |                   74.4% | `0.00/0.25/1.00/0.25`   |
| Agent task       |               75.6% |                   75.6% | `0.00/0.25/1.00/1.00`   |

The exact report is generated locally under `benchmarks/results` with schema version 2. Identifier
queries still need Dense on Effect because the current identifier extractor misses several complex
typed `export const` declarations. That is a retrieval-channel limitation, not evidence that exact
identifier routing inherently requires embeddings.

## Schema 1: Historical

> Historical schema-1 baseline. It predates four query representations, grouped cross-validation,
> automatic GPU selection, and exhaustive subset/weight evaluation. Do not compare these percentages
> directly with schema-2 artifacts.

Measured on 2026-07-30 with the pinned 45-question corpus. This is an exploratory baseline, not a
claim of statistical significance. Eight of nine repository/model cells completed; Jina on the
6,386-chunk Effect corpus exceeded one hour on CPU and remains intentionally unreported.

`Best simple variant` is the highest `R@20` among individual channels, `BM25+dense`, and RRF
leave-one-channel-out ablations. It does not include a reranker.

| Repository | Model     | Dense R@20 | BM25 R@20 | Full RRF R@20 | Best simple variant                | Best R@20 | RRF context recall at 4k |
| ---------- | --------- | ---------: | --------: | ------------: | ---------------------------------- | --------: | -----------------------: |
| Effect v4  | MiniLM    |      40.0% |     66.7% |         53.3% | BM25                               |     66.7% |                    46.7% |
| Effect v4  | BGE-small |      73.3% |     66.7% |         60.0% | RRF without CamelCase              |     73.3% |                    40.0% |
| FastAPI    | MiniLM    |      73.3% |     70.0% |         70.0% | RRF without CamelCase              |     80.0% |                    60.0% |
| FastAPI    | BGE-small |      80.0% |     70.0% |         70.0% | RRF without CamelCase              |     80.0% |                    60.0% |
| FastAPI    | Jina Code |      76.7% |     70.0% |         63.3% | RRF without CamelCase              |     83.3% |                    53.3% |
| fd         | MiniLM    |     100.0% |     73.3% |         93.3% | BM25+dense / RRF without CamelCase |    100.0% |                    73.3% |
| fd         | BGE-small |     100.0% |     73.3% |        100.0% | Dense / full RRF                   |    100.0% |                    73.3% |
| fd         | Jina Code |      93.3% |     73.3% |         86.7% | BM25+dense / RRF without CamelCase |    100.0% |                    73.3% |

## Findings

1. The current four-channel RRF is not consistently the strongest configuration. CamelCase hurts
   `R@20` on every measured FastAPI model and on both Effect models. Its constituent-word matches
   are too broad for natural-language questions at the current weight.
2. This does not provide evidence for adding a reranker yet. Removing or routing a noisy channel
   improves candidate quality before any expensive model is introduced. Candidate recall should be
   fixed before testing reranking.
3. The code-specific Jina embedder is not consistently better. It trails MiniLM or BGE on dense
   retrieval for both completed Jina corpora while costing much more to index.
4. BGE-small is the strongest dense model on the large Effect corpus and ties the best FastAPI
   `R@20`. MiniLM remains competitive, especially on the small Rust corpus.
5. A 4k estimated-token budget loses relevant chunks even when `R@20` is high. Chunk size and result
   compaction are separate optimization targets from ranking quality.

## Measured Cost

On this machine, embedding the 6,386 Effect chunks took about 5 minutes with MiniLM and 9.7 minutes
with BGE-small. FastAPI's 411 chunks took about 37 seconds with MiniLM, 82 seconds with BGE-small,
and 6.4 minutes with Jina. The interrupted Effect/Jina run exceeded one hour. These are local CPU
measurements, not portable performance guarantees.

## Next Experiment

Keep issue #101 and sparse retrieval deferred. First make the evidence-router rule family more stable
across folds, especially its score-separation calibration and context-budget trade-off, then rerun this
unchanged corpus. Only promote routing rules or test a reranker when grouped and repository holdouts
agree.
