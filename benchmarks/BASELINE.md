# Preliminary Retrieval Baseline

## Schema 6: Symmetric Log2 Evidence Kernel

Schema 6 keeps schema 5's positive dynamic bases and replaces the asymmetric linear factors with
signed, per-channel Log2 coefficients. Score separation, agreement, identifier shape, and query
length are each centered to [-1, 1]. Their contributions add in Log2 space, then the sum is clamped to
[-2, 2], allowing a final evidence multiplier from 0.25 to 4.0. No new observable signal is added.

| Validation strategy | Static R@10 | Dynamic R@10 | Static R@20 | Dynamic R@20 | Static context@4k | Dynamic context@4k |
| ------------------- | ----------: | -----------: | ----------: | -----------: | ----------------: | -----------------: |
| Grouped 5-fold      |       69.2% |        68.6% |       76.9% |        76.4% |             64.4% |              64.4% |
| Leave-one-repo-out  |       70.8% |        69.7% |       78.6% |        81.1% |             66.9% |              65.3% |
| Fit all 180 queries |       68.1% |        69.2% |       83.1% |        83.1% |             62.8% |              62.8% |

The fit-all bases are `1.00/0.50/1.00/0.70`. Score coefficients are
`0.30/-0.10/0.00/-0.10`, agreement coefficients `1.00/0.00/0.00/0.00`, and every identifier and
length coefficient is zero. Fold-selected coefficients vary substantially and often reverse signs.
Compared with schema 5, the Log2 kernel gains 0.8 points of LORO R@20 but loses 1.7 grouped points;
both holdout strategies lose R@10 relative to their static baselines. The stronger kernel can recover
cross-repository candidates, but its additional signed freedom is not stable enough for production.

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
