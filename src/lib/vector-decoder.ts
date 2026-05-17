import { Buffer } from "node:buffer"

import { Effect } from "effect"

import type { EmbeddingDtype } from "../domain/dtype.js"
import { UnknownEmbeddingDtypeError, VectorDecodeError, VectorEncodeError } from "../domain/dtype.js"

export interface VectorDecoder {
  readonly decode: (
    buffer: Uint8Array,
    dims: number,
    count: number,
  ) => Effect.Effect<Float32Array, VectorDecodeError>
  readonly encode: (vector: Float32Array) => Effect.Effect<Buffer, VectorEncodeError>
}

const fp32decoder: VectorDecoder = {
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

const notImplemented = (dtype: EmbeddingDtype): VectorDecoder => ({
  decode: () =>
    Effect.fail(
      new VectorDecodeError({
        message: `VectorDecoder.${dtype} decode not implemented`,
        dtype,
      }),
    ),
  encode: () =>
    Effect.fail(
      new VectorEncodeError({
        message: `VectorDecoder.${dtype} encode not implemented`,
        dtype,
      }),
    ),
})

export const getVectorDecoder = (dtype: EmbeddingDtype): VectorDecoder => {
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
        decode: () => Effect.fail(err),
        encode: () => Effect.fail(err),
      }
    }
  }
}
