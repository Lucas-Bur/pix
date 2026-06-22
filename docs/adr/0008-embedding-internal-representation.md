# Embedding Internal Representation: Float32Array

## Status

Accepted

## Context

The domain type `Embedding.vector` is `number[]` — provider-agnostic so that any embedder (ONNX, OpenAI, etc.) can satisfy the port. However, the arithmetic layer (cosine similarity, vector encoding/decoding) needs a performant working representation.

Vectors are stored in `vectors.bin` as raw bytes. When loaded for search, they must be decoded into a typed array for SIMD-optimized arithmetic. Different dtypes (fp32, fp16, q8, q4) require different decode paths.

## Decision

**Internal working representation is `Float32Array`.** The `VectorCodec` interface (`src/lib/vector-codec.ts`) decodes `vectors.bin` bytes → `Float32Array` and encodes `Float32Array` → bytes. `computeCosineSimilarity` operates on `Float32Array`.

The embedder adapter converts from its native format (ONNX `Float32Array`, OpenAI `number[]`, etc.) to `number[]` for the domain `Embedding`, then the codec converts back to `Float32Array` when vectors are staged for storage.

## Rationale

- **Performance**: `Float32Array` is contiguous memory, SIMD-eligible, and the native format for ONNX, TensorFlow, and every ML runtime. `number[]` is an array of boxed JS objects — 8x memory, no SIMD.
- **Correctness**: Cosine similarity requires floating-point arithmetic. Quantized dtypes (q8, q4) are dequantized to float32 before arithmetic.
- **Reversible**: The codec is the single seam between binary storage and working representation. Adding a new dtype means adding one decoder/encoder pair.

## Consequences

- **Positive**: Arithmetic is fast and correct for all dtypes. The codec interface is simple: `decode(bytes) → Float32Array`, `encode(Float32Array) → bytes`.
- **Negative**: Two conversions per vector (provider → `number[]` → `Float32Array` for storage, `Float32Array` → `number[]` for domain). Negligible for MVP-scale indexes; revisit if profiling shows it's a bottleneck.
- **Risk**: If a future provider returns `Float64Array` or `Float16Array` natively, the adapter must convert. This is acceptable — the codec already handles dtype conversion.

## Code References

- `src/domain/chunk.ts` — `Embedding.vector: number[]` (domain type)
- `src/lib/vector-codec.ts` — `VectorCodec.decode/encode` (infrastructure, uses `Float32Array`)
- `src/lib/vector-math.ts` — `computeCosineSimilarity(chunkVector: Float32Array, query: Float32Array)` (infrastructure)

## Findings: ONNX Transformers Output Dtype

The `dtype` config option (`fp32`, `fp16`, `q8`, `q4`) controls **model weight precision**, not **output activation dtype**. Regardless of weight dtype, `FeatureExtractionPipeline` always returns `tensor.type: "float32"` with `tensor.data` as `Float32Array`.

**Verified experimentally** (`scripts/check-dtype-output.mjs`):

| dtype | tensor.type                    | tensor.data constructor |
| ----- | ------------------------------ | ----------------------- |
| fp32  | float32                        | Float32Array            |
| fp16  | ❌ not supported by this model | —                       |
| q8    | float32                        | Float32Array            |
| q4    | float32                        | Float32Array            |

This means the cast `tensor.data as Float32Array` in `src/services/embedder.ts` is safe — no conversion or dequantization is needed at the inference boundary. Quantization is applied to weights only; the forward pass still produces float32 embeddings.
