import { Buffer } from "node:buffer"

import { Effect, Exit } from "effect"
import { describe, expect, it } from "vite-plus/test"

import { getVectorCodec } from "./vector-codec.js"

const makeTestBuffer = (dims: number, count: number): Uint8Array =>
  new Uint8Array(new Float32Array(dims * count).buffer)

describe("fp32 decoder", () => {
  const codec = getVectorCodec("fp32")

  it("decodes a valid buffer", () =>
    Effect.gen(function* () {
      const buf = makeTestBuffer(3, 2)
      const result = yield* codec.decode(buf, 3, 2)
      expect(result.length).toBe(6)
    }).pipe(Effect.runPromise))

  it("fails on buffer size mismatch", () =>
    Effect.gen(function* () {
      const buf = new Uint8Array(10)
      const result = yield* Effect.exit(codec.decode(buf, 3, 2))
      expect(Exit.isFailure(result)).toBe(true)
    }).pipe(Effect.runPromise))

  it("encodes a Float32Array to Buffer", () =>
    Effect.gen(function* () {
      const v = new Float32Array([1, 2, 3])
      const buf = yield* codec.encode(v)
      expect(buf).toBeInstanceOf(Buffer)
      expect(buf.byteLength).toBe(12)
    }).pipe(Effect.runPromise))
})

describe("unsupported dtypes", () => {
  for (const dtype of ["fp16", "q8", "q4"] as const) {
    it(`${dtype} decode returns VectorDecodeError`, () =>
      Effect.gen(function* () {
        const codec = getVectorCodec(dtype)
        const result = yield* Effect.exit(codec.decode(new Uint8Array(4), 1, 1))
        expect(Exit.isFailure(result)).toBe(true)
      }).pipe(Effect.runPromise))

    it(`${dtype} encode returns VectorEncodeError`, () =>
      Effect.gen(function* () {
        const codec = getVectorCodec(dtype)
        const result = yield* Effect.exit(codec.encode(new Float32Array(1)))
        expect(Exit.isFailure(result)).toBe(true)
      }).pipe(Effect.runPromise))
  }
})

describe("unknown dtype", () => {
  it("decode/encode die with UnknownEmbeddingDtypeError", () =>
    Effect.gen(function* () {
      const codec = getVectorCodec("invalid" as never)
      const decodeExit = yield* Effect.exit(codec.decode(new Uint8Array(4), 1, 1))
      expect(decodeExit._tag).toBe("Failure")
    }).pipe(Effect.runPromise))

  it("encode dies with UnknownEmbeddingDtypeError", () =>
    Effect.gen(function* () {
      const codec = getVectorCodec("invalid" as never)
      const encodeExit = yield* Effect.exit(codec.encode(new Float32Array(1)))
      expect(encodeExit._tag).toBe("Failure")
    }).pipe(Effect.runPromise))
})
