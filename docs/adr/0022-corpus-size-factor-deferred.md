# 0022: Corpus-size factor stays out of production pending replication

## Status

Accepted

## Context

The evidence router has no representation of index size. Issue #175 asked whether optimal channel
weights shift with corpus size enough to justify a query-independent corpus-size factor that scales
`baseWeights` before the per-query evidence factors.

`vp run bench:retrieval:corpus-size:model` sub-samples one pinned corpus to fixed chunk counts, runs
the full search protocol at every size, and fits a per-channel log-linear model over
`log(chunkCount)`. First real measurements (MiniLM, DBSF, search-priority, grouped 3-fold, holdout
NDCG@20 of the fit-all direct router; artifacts
`retrieval-corpus-size-model-t3code-…` and `retrieval-corpus-size-model-effect-v4-…`):

| Corpus    | Sizes                   | Sparse weight trend    | Sparse slope | Pairs outside noise | Sensitivity verdict |
| --------- | ----------------------- | ---------------------- | ------------ | ------------------- | ------------------- |
| t3code    | 200 / 500 / 1000 / 1306 | 0.9 → 0.6 → 0.5 → 0.3  | -0.291       | 9                   | promote             |
| effect-v4 | 200 / 500 / 1000 / 6786 | 0.9 → 0.67 → 1.0 → 0.2 | -0.189       | 14                  | promote             |

Quality falls with size on both corpora (t3code 0.88 → 0.70, effect-v4 0.89 → 0.36 NDCG@20), so
larger corpora are genuinely harder. The replicated signals across both corpora:

- **Sparse weight declines with corpus size** (both slopes strongly negative). The learned-sparse
  channel contributes relatively less as the index grows.
- Lexical/identity channels gain relative weight at scale on effect-v4 (bm25 slope +0.16,
  identity +0.12), but the signs flip or stay flat on t3code (bm25 -0.06, identity 0.00).
- Per-size optima wobble at discrete level resolution (effect-v4 size 1000 orders channels
  differently from size 6786), and per-size noise is ±0.02–0.04 NDCG@20.

## Decision

- Do **not** add a corpus-size factor to `EvidenceRouterParameters` yet. The sensitivity check says
  weights shift outside noise, but only the sparse decline replicates across both corpora; the
  other channels flip signs between corpora, one model and two corpora is thin evidence, and the
  quality cost of keeping static weights is unmeasured.
- Keep the sweep as the standing measurement: `vp run bench:retrieval:corpus-size:model` with
  `PIX_BENCH_CORPUS_SIZE_REPO` and `PIX_BENCH_CORPUS_SIZES` knobs. Re-run it when a new corpus or
  model lands.
- Promotion bar: the same channel shows the same sign of log-linear slope on at least two corpora
  and two models, and a follow-up measurement shows that applying the size-200 optimum at full size
  costs more than one noise band of NDCG@20 versus the per-size optimum. Only then wire the factor
  as a query-independent `baseWeights` prior with tiny/empty/large-corpus edge-case tests.
- Until then, corpus size stays a reported benchmark axis, not a production input.

## Rationale

The issue's own bar is that a factor must earn its runtime input (`bm25Index.chunkLengths.length`)
and parameter space through evidence. Two corpora and one model replicate one channel signal, not a
model. Wiring a factor on that basis adds a production configuration dimension before the benchmark
can say how much quality the factor recovers. The sweep machinery stays in the repo, so the
promotion decision re-runs in minutes rather than restarting the research.
