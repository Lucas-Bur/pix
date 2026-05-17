import { Buffer } from "node:buffer"

import { Effect } from "effect"

import type { EmbeddingDtype } from "../domain/dtype.js"
import {
  UnknownEmbeddingDtypeError,
  VectorDecodeError,
  VectorEncodeError,
} from "../domain/dtype.js"

/**
 * Translates between binary vector storage and the internal working representation.
 *
 * Uses `Float32Array` for all arithmetic — contiguous memory, SIMD-eligible, native ML format. The
 * domain type `Embedding.vector` is `number[]` (provider-agnostic), but the codec bridges to
 * `Float32Array` for performance. See ADR-0008.
 */
export interface VectorCodec {
  readonly decode: (
    buffer: Uint8Array,
    dims: number,
    count: number,
  ) => Effect.Effect<Float32Array, VectorDecodeError>
  readonly encode: (vector: Float32Array) => Effect.Effect<Buffer, VectorEncodeError>
}

const fp32decoder: VectorCodec = {
  decode: (buffer, _dims, _count) =>
    Effect.succeed(
      new Float32Array(
        buffer.buffer,
        buffer.byteOffset,
        buffer.byteLength / Float32Array.BYTES_PER_ELEMENT,
      ),
    ),
  encode: (vector) => Effect.succeed(Buffer.from(vector.buffer)),
}

const notImplemented = (dtype: EmbeddingDtype): VectorCodec => ({
  decode: () =>
    Effect.fail(
      new VectorDecodeError({
        message: `VectorCodec.${dtype} decode not implemented`,
        dtype,
      }),
    ),
  encode: () =>
    Effect.fail(
      new VectorEncodeError({
        message: `VectorCodec.${dtype} encode not implemented`,
        dtype,
      }),
    ),
})

export const getVectorCodec = (dtype: EmbeddingDtype): VectorCodec => {
  switch (dtype) {
    case "fp32":
      return fp32decoder
    case "fp16":
    case "q8":
    case "q4":
      return notImplemented(dtype)
    default: {
      const _exhaustive: never = dtype
      const err = new UnknownEmbeddingDtypeError({
        message: `Unknown EmbeddingDtype: ${String(_exhaustive)}`,
      })
      return {
        decode: () => Effect.die(err),
        encode: () => Effect.die(err),
      }
    }
  }
}
