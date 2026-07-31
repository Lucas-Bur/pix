# Embedding Internal Representation: Float32Array

## Status

Accepted

## Context

The domain type `Embedding.vector` is `number[]` — provider-agnostic so that any embedder (ONNX, OpenAI, etc.) can satisfy the port. However, the arithmetic layer (cosine similarity, vector encoding/decoding) needs a performant working representation.

Vectors are stored as raw Float32 BLOBs in `.pix/index.db`. Although the `dtype` config selects model weight precision (fp32, fp16, q8, q4), ONNX `FeatureExtractionPipeline` always emits `Float32Array` output regardless of weight dtype (see Findings below), so one fp32 storage path serves every dtype.

## Decision

**Internal working representation is `Float32Array`.** A bidirectional Effect Schema transforms aligned arrays to and from SQLite BLOBs, validates byte lengths, and copies sliced views correctly. sqlite-vector consumes those BLOBs directly and performs the dense search; there is no duplicate JavaScript cosine-search implementation.

The embedder adapter converts from its native format (ONNX `Float32Array`, OpenAI `number[]`, etc.) to `number[]` for the domain `Embedding`, then `serializeVectors` lays those values into a contiguous `Float32Array` for storage.

## Rationale

- **Performance**: `Float32Array` is contiguous memory, SIMD-eligible, and the native format for ONNX, TensorFlow, and every ML runtime. `number[]` is an array of boxed JS objects — 8x memory, no SIMD.
- **Correctness**: Cosine similarity requires floating-point arithmetic. The output of `FeatureExtractionPipeline` is already float32 regardless of weight dtype (see Findings), so no dequantization step is needed at read time.
- **No dtype switch at the storage seam**: Because every dtype produces float32 output, vector BLOBs always contain Float32Array bytes. Persisted dtype remains metadata used by `DtypeMismatchError`, not a selector between decode paths.

## Consequences

- **Positive**: One storage format, one read path. No codec abstraction to maintain; adding a new dtype only requires registering it in `EmbeddingDtypeSchema` and `MODEL_REGISTRY`.
- **Negative**: Two conversions per vector (provider → `number[]` → `Float32Array` for storage, `Float32Array` → `number[]` for domain). Negligible for MVP-scale indexes; revisit if profiling shows it's a bottleneck.
- **Risk**: If a future provider returns `Float64Array` or `Float16Array` natively, the adapter must convert to `Float32Array` before handing to `serializeVectors`. This is a localised concern in the adapter, not a storage-format change.

## Code References

- `src/domain/chunk.ts` — `Embedding.vector: number[]` (domain type)
- `src/services/sqlite-index-store/schema.ts` — bidirectional Float32 BLOB schema
- `src/services/sqlite-index-store.ts` — validated persistence and native vector search
- `src/services/sqlite-index-store.ts` — native exact and optional approximate vector search

## Findings: ONNX Transformers Output Dtype

The `dtype` config option (`fp32`, `fp16`, `q8`, `q4`) controls **model weight precision**, not **output activation dtype**. Regardless of weight dtype, `FeatureExtractionPipeline` always returns `tensor.type: "float32"` with `tensor.data` as `Float32Array`.

**Verified experimentally** across all working dtype/model combinations (see `tests/scripts/check-dtype-output.mjs`):

| Model                                      | fp32         | fp16          | q8           | q4                |
| ------------------------------------------ | ------------ | ------------- | ------------ | ----------------- |
| Xenova/all-MiniLM-L6-v2 (384d)             | Float32Array | ❌ ONNX crash | Float32Array | —                 |
| Xenova/bge-small-en-v1.5 (384d)            | Float32Array | ❌ ONNX crash | Float32Array | —                 |
| jinaai/jina-embeddings-v2-base-code (768d) | Float32Array | —             | Float32Array | ❌ file not found |

All working dtypes produce `tensor.type: "float32"`, `tensor.data: Float32Array`. fp16 crashes with `InsertedPrecisionFreeCast` ONNX error across all tested models. q4 ONNX file does not exist on the HuggingFace hub for the jina model. The `MODEL_REGISTRY` dtypes reflect only verified-working combinations.

This means the cast `tensor.data as Float32Array` in `src/services/embedder.ts` is safe — no conversion or dequantization is needed at the inference boundary. Quantization is applied to weights only; the forward pass still produces float32 embeddings.
