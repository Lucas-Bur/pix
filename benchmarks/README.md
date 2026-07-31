# Retrieval Quality Benchmark

This local-only suite measures whether pix retrieves the right source locations. It is separate from
`pix bench`, which measures embedding hardware throughput, and it does not add a product CLI or MCP
surface.

## Questions

The suite answers five questions independently:

1. Do identity, CamelCase, BM25, and dense retrieval each contribute useful candidates?
2. Does production-weighted RRF improve `Recall@K` over individual channels and combinations?
3. Does full RRF reduce the quality gap between a small general embedder and a code-specific one?
4. How much authored ground truth fits into fixed context budgets?
5. Can one evidence-based router outperform static weights without knowing the authored query form?

A reranker is deliberately absent. Issue #101 should proceed only if this suite shows that relevant
locations enter the candidate set but remain outside the useful top ranks. A reranker cannot recover
locations missing from the candidate set.

## Local-First Retrieval Strategy

pix targets ordinary developer laptops, so retrieval quality must be considered together with index
cost, memory use, query latency, and context size. The benchmark therefore starts with several cheap,
complementary candidate generators and learns when their evidence is trustworthy instead of relying
on one large retriever followed by an expensive reranker.

This ordering matters because retrieval and reranking solve different problems. Identity, CamelCase,
BM25, and a small dense model can contribute candidates that another channel misses. Evidence-aware
fusion improves the candidate pool itself; a reranker can only reorder candidates already present.
Sending 100 weak candidates through a reranker also spends compute on work that better routing may
avoid. The intended pipeline is therefore:

1. Generate complementary candidates with small local channels.
2. Use query and channel evidence to suppress noise and fuse a compact high-recall set.
3. Pack the strongest complete chunks into the available context budget.
4. Add a reranker only if holdout results show that gold locations consistently enter a small
   candidate pool but remain outside the required top ranks.

The goal is not to reject rerankers categorically. It is to make candidate generation strong enough
that no reranker is needed for common queries, or that an optional reranker only processes a small
pool such as 20 candidates to select the final 10. This maximizes retrieval quality per unit of local
compute and lets small embedding models remain useful on hardware without a high-end accelerator. If
lexical, identity, and agreement evidence close most of the quality gap between a small dense model
and a larger one after fusion, that is a successful result: the system should pay for a stronger model
only when its incremental holdout quality justifies the additional indexing time, memory, and latency.

## Corpora

Every corpus is pinned and contains 15 manually verified navigation intents. Each intent has four
query representations: exact identifier, search phrase, natural question, and agent task. All four
representations remain in the same validation fold. Gold targets are exact `file + symbol` pairs.
Matching uses extracted identifiers or exact declaration syntax inside the specified file; loose
symbol-name segment matching is not accepted.

| Corpus    | Revision                                   | Language   | Size band | Indexed scope                 |
| --------- | ------------------------------------------ | ---------- | --------- | ----------------------------- |
| FastAPI   | `95f8322ee1dcda7ceace7b1c4f6c9915b36d748f` | Python     | medium    | `fastapi/**/*.py`             |
| Effect v4 | `9263ba30c4535b655cf69a14f44a43cb9a93921e` | TypeScript | large     | `packages/effect/src/**/*.ts` |
| fd        | `41532d114e2ba565fb5367d606c111b29b96450c` | Rust       | small     | `src/**/*.rs`                 |

Effect's vendored Scalar and Swagger browser bundles are excluded explicitly. They are minified
JavaScript stored in giant TypeScript string literals, exceed Tree-sitter's input limit, and are not
meaningful source-navigation targets.

## Commands

Run the deterministic authored fixture:

```bash
vp run bench:retrieval:fixture
```

Validate all pinned checkouts and gold locations without loading embedding models:

```bash
vp run bench:retrieval:corpus
```

Use the smallest profile that provides the evidence needed for the current change:

```bash
vp run bench:retrieval:smoke
vp run bench:retrieval:develop
vp run bench:retrieval:validate
vp run bench:retrieval:full
```

| Profile    | Repositories | Models   | Validation                    | Fusion and diagnostics            |
| ---------- | ------------ | -------- | ----------------------------- | --------------------------------- |
| `smoke`    | fd           | MiniLM   | grouped 5-fold                | DBSF, current router              |
| `develop`  | all three    | MiniLM   | grouped 3-fold                | DBSF, current router              |
| `validate` | all three    | MiniLM   | grouped 5-fold and repository | DBSF, current router              |
| `full`     | all three    | selected | grouped 5-fold and repository | all fusion and legacy diagnostics |

`bench:retrieval` aliases `bench:retrieval:validate`. Every profile measures the same physical
rankings and retrieval variants; profiles only control matrix size, holdout coverage, and expensive
diagnostics. The selected profile is recorded in schema-7 artifacts without changing retrieval
semantics.

The first run clones repositories into `benchmarks/.cache/repos` and downloads missing Hugging Face
models. The highest-priority working device is selected automatically and recorded in the artifact.
The maximum embedding batch size is two; unusually long chunks run individually. Chunk vectors are
cached by corpus content, revision, dimensions, model, device, and batch size, so interrupted or split
matrix runs can resume without repeating successful embeddings. Both caches are local and excluded
from Git. Limit an exploratory run with comma-separated environment variables:

```powershell
$env:PIX_BENCH_REPOS = "fd"
$env:PIX_BENCH_MODELS = "Xenova/all-MiniLM-L6-v2"
vp run bench:retrieval:validate
```

Supported repository IDs are `fastapi`, `effect-v4`, and `fd`. Every profile runs exactly one model,
defaulting to MiniLM. Select another with `PIX_BENCH_MODELS`. Supported values are the three models in
`MODEL_REGISTRY`:

- `Xenova/all-MiniLM-L6-v2`
- `Xenova/bge-small-en-v1.5`
- `jinaai/jina-embeddings-v2-base-code`

The Jina code model cannot embed Effect's longest 7,103-token AST chunk on the tested DML GPU even as
a single-item batch. Do not silently truncate, re-chunk only one model, or mix CPU and GPU vectors to
complete that cell: any of those choices changes the comparison. Treat the cell as unsupported until
the corpus uses a shared hard token limit for every model.

## Matrix

Each model embeds a repository and all query representations once. Those vectors and the four
physical channel rankings are reused for every fusion experiment:

- each physical channel: identity, CamelCase, BM25, dense
- all 15 non-empty channel subsets
- production-weighted RRF and leave-one-channel-out diagnostics
- a coarse relative weight grid with 255 raw configurations followed by bounded 0.1-step refinement
- exact Shapley contribution for holdout `Recall@20`
- static Weighted RRF, relative-score, and distribution-based score fusion with independently tuned
  weights
- an evidence router using query length and identifier shape plus each channel's availability,
  scale-independent score separation, and cross-channel top-rank agreement

This separates channel contribution from model sensitivity without repeating embedding inference for
every ablation.

### Fusion Methods

Weighted RRF uses rank positions and deliberately discards raw score magnitude. Relative-score fusion
min-max normalizes each channel's top-200 scores before a weighted sum. DBSF computes each top-200
list's mean and sample standard deviation, maps the three-sigma interval to a comparable scale, then
sums weighted normalized scores. A constant or single-result channel contributes 0.5 instead of
dividing by zero. Missing candidates contribute nothing. Every fusion method selects its own positive
weights; weights are not transferred between formulas with different semantics.
Schema 8 uses DBSF for both sides of the evidence-router comparison: one static DBSF vector versus
per-query DBSF weights produced by the existing schema-5 linear router.

## Validation

Weight selection uses two grouped strategies:

- Grouped 5-fold: intent index modulo five, balanced across all three repositories. The four query
  representations of an intent never cross folds.
- Leave-one-repository-out: calibrate on two repositories and validate on the third. This is emitted
  only when multiple repositories are selected in the same run.

The grid optimizes development `Recall@20`, then `Recall@10`, 4k context recall, and MRR. Each fold's
weights are evaluated unchanged on its excluded samples. Only after cross-validation does the report
fit a recommended deployment candidate on all available samples. Weight search limits each physical
channel to its top 200 candidates; ordinary production-variant measurements still use complete lists.

Static weight search treats the four authored query forms as separate query-form-informed strata. Evidence-router
search deliberately combines all forms: it does not receive `identifier`, `searchPhrase`,
`naturalQuestion`, or `agentTask` labels. Search starts from the coarse grid, retains a six-candidate
beam, then performs two coordinate passes in 0.1 steps. Dynamic base weights range from 0.1 to 1 so a
channel cannot be permanently deleted before its evidence is observed; static ablations may still use
zero. Per-channel score/agreement coefficients range from 0 to 1. Identifier-shape and query-length
slopes range from -1 to 1 so one query signal may boost one channel while damping another. This
bounded coarse-to-fine search avoids the combinatorial explosion of a full 20-parameter product; it is
deterministic but does not claim a global optimum. Exact metric ties prefer the lower-coefficient
candidate.

The selected router is evaluated unchanged on the excluded intent fold or repository and compared
with static weights selected on the same development samples. Finer steps increase the number of
hypotheses, so holdout quality and coefficient stability matter more than fit-all quality.

Score separation is normalized within a channel ranking. Raw BM25 and cosine scores are never
compared across channels or embedding models. Empty channels receive zero weight; ambiguous rankings
can be downweighted but retain a floor so complementary evidence is not discarded blindly.

## Metrics

- `Recall@5/10/20`: fraction of authored gold targets represented by at least one returned chunk.
- `Success@10/20`: whether all authored targets for the question are represented.
- `MRR`: reciprocal rank of the first relevant chunk; rank-sensitive but secondary for navigation.
- `ContextRecall@Budget`: gold recall after packing complete ranked chunks into 2k, 4k, 8k, or 16k
  estimated tokens.

Context tokens use the deterministic `ceil(UTF-8 bytes / 4)` estimator. These are not provider
thinking tokens and should not be presented as exact billing usage. The estimator isolates retrieval
output size without introducing an LLM or provider-specific tokenizer.

Each run writes ignored JSON and Markdown artifacts under `benchmarks/results`. JSON rows retain the
repository, revision, language, size, category, difficulty, query form, grouped fold, model, variant,
individual gold ranks, timing, and every metric. The Markdown report includes quality by query form,
marginal leave-one-channel-out contribution, cross-validation folds, Shapley values, and final fitted
weight candidates. Schema 8 artifacts also include static fusion holdouts, fit-all fusion candidates,
static-versus-dynamic DBSF router holdouts, and the final router candidate fitted across all query
forms. The router's fusion method is recorded explicitly.

## Interpretation

Compare dense-only model deltas with full-RRF model deltas. If Jina substantially improves dense-only
quality but the gap collapses after fusion, the other channels make the small default embedder less
critical. Compare full RRF with each leave-one-channel-out row before changing channel weights: a
channel may help one language or query category while hurting another.

Do not infer statistical significance from one repository or from the 15-question smoke corpus.
Expand the authored questions and preserve pinned revisions before making a product-wide claim.

The evidence router is currently benchmark-only. Promote a rule into production only when grouped
intent folds and leave-one-repository-out both show that its dynamic holdout quality improves or
matches the static baseline without unacceptable context-recall regressions.
