import { expect, it } from "@effect/vitest"
import { Effect, Layer } from "effect"

import { IndexStore } from "../domain/ports.js"
import { GetStatus, GetStatusLive, type StatusResult } from "./get-status.js"

const getStatusLayer = (status: StatusResult) =>
  Layer.provide(
    GetStatusLive,
    Layer.mock(IndexStore)({
      getStatus: () => Effect.succeed(status),
    }),
  )

it.effect("GetStatus.getStatus returns the persisted index model", () =>
  Effect.gen(function* () {
    const result = yield* (yield* GetStatus).getStatus()
    expect(result.chunks).toBe(2)
    expect(result.files).toBe(2)
    expect(result.model).toBe("test-model")
    expect(result.totalLines).toBe(3)
  }).pipe(
    Effect.provide(
      getStatusLayer({
        chunks: 2,
        files: 2,
        model: "test-model",
        lastIndex: Date.now(),
        totalLines: 3,
        byteSize: 19,
        validationErrors: [],
        diagnostics: [],
      }),
    ),
  ),
)

it.effect("GetStatus.getStatus returns empty model when no index exists", () =>
  Effect.gen(function* () {
    const result = yield* (yield* GetStatus).getStatus()
    expect(result.model).toBe("")
    expect(result.chunks).toBe(2)
    expect(result.files).toBe(2)
  }).pipe(
    Effect.provide(
      getStatusLayer({
        chunks: 2,
        files: 2,
        model: "",
        lastIndex: 0,
        totalLines: 3,
        byteSize: 0,
        validationErrors: [],
        diagnostics: [],
      }),
    ),
  ),
)
