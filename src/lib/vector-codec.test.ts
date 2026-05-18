import { Buffer } from "node:buffer"

import { Cause, Effect, Exit } from "effect"
import { describe, expect, it } from "vite-plus/test"

import {
  UnknownEmbeddingDtypeError,
  VectorDecodeError,
  VectorEncodeError,
} from "../domain/dtype.js"
import { getVectorCodec } from "./vector-codec.js"

const makeTestBuffer = (dims: number, count: number): Uint8Array =>
  new Uint8Array(new Float32Array(dims * count).buffer)

const expectFailure = async <E>(
  effect: Effect.Effect<unknown, E>,
  ErrorCtor: Function,
): Promise<E> => {
  const exit = await Effect.runPromise(Effect.exit(effect))
  if (!Exit.isFailure(exit)) expect.fail("Expected failure, got success")
  const failure = Cause.failureOption(exit.cause)
  if (failure._tag !== "Some") expect.fail("Expected failure cause, got empty")
  expect(failure.value).toBeInstanceOf(ErrorCtor)
  return failure.value as E
}

const expectDie = async <D>(
  effect: Effect.Effect<unknown, unknown>,
  ErrorCtor: Function,
): Promise<D> => {
  const exit = await Effect.runPromise(Effect.exit(effect))
  if (!Exit.isFailure(exit)) expect.fail("Expected die, got success")
  const die = Cause.dieOption(exit.cause)
  if (die._tag !== "Some") expect.fail("Expected die cause, got empty")
  expect(die.value).toBeInstanceOf(ErrorCtor)
  return die.value as D
}

describe("fp32 codec", () => {
  it("returns the same fp32decoder instance on every call", () => {
    const a = getVectorCodec("fp32")
    const b = getVectorCodec("fp32")
    expect(a).toBe(b)
  })

  it("decodes a valid buffer", () =>
    Effect.gen(function* () {
      const codec = getVectorCodec("fp32")
      const buf = makeTestBuffer(3, 2)
      const result = yield* codec.decode(buf, 3, 2)
      expect(result.length).toBe(6)
      expect(result).toBeInstanceOf(Float32Array)
    }).pipe(Effect.runPromise))

  it("fails on buffer size mismatch", () =>
    expectFailure(getVectorCodec("fp32").decode(new Uint8Array(10), 3, 2), VectorDecodeError).then(
      (err) => expect(err.message).toContain("Invalid vector buffer length"),
    ))

  it("encodes a Float32Array to Buffer", () =>
    Effect.gen(function* () {
      const codec = getVectorCodec("fp32")
      const v = new Float32Array([1, 2, 3])
      const buf = yield* codec.encode(v)
      expect(buf).toBeInstanceOf(Buffer)
      expect(buf.byteLength).toBe(12)
    }).pipe(Effect.runPromise))
})

describe("unsupported dtypes", () => {
  for (const dtype of ["fp16", "q8", "q4"] as const) {
    describe(dtype, () => {
      it("decode returns VectorDecodeError with not-implemented message", () =>
        expectFailure(
          getVectorCodec(dtype).decode(new Uint8Array(4), 1, 1),
          VectorDecodeError,
        ).then((err) => {
          expect(err.message).toContain("not implemented")
          expect(err.dtype).toBe(dtype)
        }))

      it("encode returns VectorEncodeError with not-implemented message", () =>
        expectFailure(getVectorCodec(dtype).encode(new Float32Array(1)), VectorEncodeError).then(
          (err) => {
            expect(err.message).toContain("not implemented")
            expect(err.dtype).toBe(dtype)
          },
        ))
    })
  }
})

describe("unknown dtype", () => {
  it("decode dies with UnknownEmbeddingDtypeError", () =>
    expectDie(
      getVectorCodec("invalid" as never).decode(new Uint8Array(4), 1, 1),
      UnknownEmbeddingDtypeError,
    ))

  it("encode dies with UnknownEmbeddingDtypeError", () =>
    expectDie(
      getVectorCodec("invalid" as never).encode(new Float32Array(1)),
      UnknownEmbeddingDtypeError,
    ))
})
