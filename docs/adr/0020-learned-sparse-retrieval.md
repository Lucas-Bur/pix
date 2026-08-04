# 0020: Learned sparse retrieval with SQLite postings

## Status

Accepted

## Context

The OpenSearch v3 Distill document encoder improves historical production RRF recall as a complementary
fifth channel. Its output is a variable-length map of vocabulary token IDs to positive weights, so the dense
Float32 vector representation and sqlite-vector cosine scans do not fit this data model.

The selected Hugging Face repository is a Sentence-Transformers `SparseEncoder` router. Its document
ONNX model and tokenizer/config files live in separate module directories. Transformers.js 4.2 cannot
construct a normal pipeline from that repository root because `SparseEncoder` is not a supported model
type and one pipeline `subfolder` cannot point at both module directories.

## Decision

- Learned Sparse is a required fifth production channel. There is no `enabled` switch or disabled
  compatibility path.
- Use `raul3820/opensearch-neural-sparse-encoding-doc-v3-distill-onnx`, pinned by commit SHA. Load its
  standard DistilBERT masked-language model through Transformers.js `AutoModelForMaskedLM` and its
  paired tokenizer through `AutoTokenizer`. Transformers.js still owns downloading, ONNX selection,
  and execution.
- Default Sparse execution to `device: "auto"`. Dense and Sparse share one generic first-working-device
  loader and the priority `cuda → dml → coreml → webgpu → wasm → cpu`; each channel supplies its real
  model loader. Explicit devices remain strict and do not silently fall back.
- Use the paired OpenSearch query model's pinned `idf.json`. Verify its SHA-256 before indexing and
  persist the complete static token-ID lookup in SQLite. Query processes never download IDF data.
- Encode documents by max-pooling positive vocabulary logits across attended positions, then applying
  `log1p(log1p(value))` and removing special tokens.
- Store the model, model revision, tokenizer, tokenizer revision, IDF revision, and IDF content hash in
  singleton `sparse_index_meta`. Store static query weights in `sparse_idf` and document postings in
  `sparse_terms(chunk_ordinal, token_id, weight)`.
- Index `sparse_terms(token_id, chunk_ordinal, weight)` as a covering postings index. sqlite-vector has
  no variable sparse-vector type, so ordinary STRICT tables are the native representation.
- Compute exact query scores in SQLite by joining tokenized query IDs to `sparse_idf` and
  `sparse_terms`, then summing `idf_weight * document_weight` per chunk.
- Replace chunks, Sparse metadata, IDF, and postings in the existing adapter-owned transaction. Reuse
  unchanged Sparse vectors by content hash only when the complete Sparse contract matches.
- Fuse Sparse through the production fusion seam. The initial compatibility implementation used RRF with
  fixed weight `1.0`; the current promoted DBSF evidence-router configuration owns the active Sparse
  weight and query-length influences.

## Rationale

Model artifacts normally stay in the project-local `.pix/cache`. Windows projects below OneDrive use
`%LOCALAPPDATA%\pix\transformers-cache` instead because ONNX Runtime cannot load ONNX files represented
as OneDrive reparse points, even though Node.js can read the same files.

## Performance and storage

- Document inference is bounded by `sparseEmbedder.batchSize` (default `2`). At the model's 30,522-word
  vocabulary and maximum sequence length 512, the logits tensor is approximately 119 MiB per batch of
  two; increasing this setting directly increases peak memory.
- Query inference runs no transformer. It performs cached tokenization followed by indexed SQLite
  joins against the persisted static IDF table.
- The pinned ONNX repository occupies about 91 MB before runtime allocations. First use includes its
  download; subsequent processes reuse the resolved Transformers cache (`.pix/cache`, or the local
  Windows OneDrive-safe cache).
- `pix status` accounts for 12 logical payload bytes per Sparse posting or IDF row (integer token ID
  plus REAL weight). SQLite table and B-tree overhead is additional and depends on page utilization.
- The real adapter test loads the pinned export, encodes a two-document batch, verifies all IDF rows,
  and tokenizes a query. Exact latency remains hardware-dependent; no approximate Sparse path exists.

## Consequences

- Every newly built index pays the Sparse model, inference, and storage cost in exchange for improved
  recall; old SQLite indexes migrate structurally and trigger one clean rebuild because they lack a
  Sparse contract.
- Queries remain offline after indexing and do not load the document transformer when the index is
  already fresh.
- Model, tokenizer, revision, or IDF hash changes invalidate Sparse reuse and rebuild the complete
  committed snapshot.
- ADRs 0009, 0017, 0018, and 0019 remain valid; this ADR changes their four-channel/future-Sparse
  descriptions to a five-channel production system.
