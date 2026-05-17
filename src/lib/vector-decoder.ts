import { Buffer } from "node:buffer"

import type { EmbeddingDtype } from "../domain/dtype.js"

export interface VectorDecoder {
  readonly decode: (buffer: Uint8Array, dims: number, count: number) => Float32Array
  readonly encode: (vector: Float32Array) => Buffer
}

const fp32decoder: VectorDecoder = {
  decode: (buffer, _dims, _count) =>
    new Float32Array(
      buffer.buffer,
      buffer.byteOffset,
      buffer.byteLength / Float32Array.BYTES_PER_ELEMENT,
    ),
  encode: (vector) => Buffer.from(vector.buffer),
}

const notImplemented = (dtype: string): VectorDecoder => ({
  decode: () => {
    throw new Error(`VectorDecoder.${dtype} decode not implemented`)
  },
  encode: () => {
    throw new Error(`VectorDecoder.${dtype} encode not implemented`)
  },
})

export const getVectorDecoder = (dtype: EmbeddingDtype): VectorDecoder => {
  switch (dtype) {
    case "fp32":
      return fp32decoder
    case "fp16":
    case "q8":
    case "q4":
      return notImplemented(dtype)
  }
}
